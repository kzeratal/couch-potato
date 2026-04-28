import { posix } from "node:path";
import type { Ignore } from "ignore";
import type { ShadowConfig } from "./config.ts";
import { gitShow, gitTreeHash, lsTreeShallow } from "./git.ts";
import { isIgnored } from "./ignore.ts";
import {
  parseSummaryFromBody,
  readMapFile,
  writeMapFile,
} from "./map-file.ts";
import { mapPathFor } from "./mirror.ts";
import { type DirSummary, summarizeDir } from "./summarize.ts";

export interface ScanContext {
  shadow: string;
  cfg: ShadowConfig;
  cache: Map<string, DirSummary>;       // dirRel -> summary (so parents can reference children)
  ignore?: Ignore;                       // optional gitignore-style filter for files/subdirs
}

export interface ScanOneResult {
  scanned: boolean;                     // false if skipped
  summary?: DirSummary;
}

export function newScanContext(shadow: string, cfg: ShadowConfig, ig?: Ignore): ScanContext {
  return { shadow, cfg, cache: new Map(), ignore: ig };
}

export function depth(dirRel: string): number {
  if (dirRel === "") return 0;
  return dirRel.split("/").length;
}

export function displayDir(dirRel: string): string {
  return dirRel === "" ? "/" : "/" + dirRel;
}

/**
 * Run `fn` over `items` in parallel with at most `limit` concurrent workers.
 * Each worker grabs the next free index — O(1) dispatch, no array shuffling.
 */
async function runWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Scan a list of dirs bottom-up, parallelizing within each depth level.
 * Children at depth d+1 finish before parents at depth d start, so parents
 * always find child summaries in `ctx.cache`.
 *
 * Note: a wave finishes only when its slowest dir does, so workers can sit
 * idle on unbalanced waves. A fully topological scheduler (each dir ready
 * when its direct children are done) would eliminate that idle time but is
 * more complex; the wave model is simple, correct, and good enough.
 */
export async function scanWaves(
  ctx: ScanContext,
  dirs: string[],
  opts: { force?: boolean; concurrency?: number } = {},
): Promise<{ scanned: number }> {
  const concurrency = Math.max(1, opts.concurrency ?? 8);

  // One sort gives bottom-up order; consecutive same-depth runs are waves.
  const sorted = dirs.slice().sort(
    (a, b) => depth(b) - depth(a) || a.localeCompare(b),
  );

  let scanned = 0;
  let i = 0;
  while (i < sorted.length) {
    const d = depth(sorted[i]!);
    let j = i + 1;
    while (j < sorted.length && depth(sorted[j]!) === d) j++;
    const wave = sorted.slice(i, j);

    const results = new Array<ScanOneResult>(wave.length);
    await runWithLimit(wave, concurrency, async (dirRel, idx) => {
      console.log(`scan  ${displayDir(dirRel)}`);
      results[idx] = await scanOneDir(ctx, dirRel, { force: opts.force });
    });
    scanned += results.reduce((n, r) => n + (r.scanned ? 1 : 0), 0);

    i = j;
  }

  return { scanned };
}

/**
 * Scan a single directory: read its files + child summaries, call LLM,
 * write _MAP.md, populate cache for parents to reference.
 *
 * Caller is responsible for processing dirs bottom-up so child summaries
 * are in `ctx.cache` by the time the parent is scanned.
 */
export async function scanOneDir(
  ctx: ScanContext,
  dirRel: string,
  opts: { force?: boolean } = {},
): Promise<ScanOneResult> {
  const mapPath = mapPathFor(ctx.shadow, dirRel);
  const fm = await readMapFile(mapPath);

  if (fm.status === "scanned" && !opts.force) {
    const cached = parseSummaryFromBody(fm.body);
    if (cached) {
      ctx.cache.set(dirRel, cached);
      return { scanned: false, summary: cached };
    }
  }

  // Refresh files + children directly from real repo at the configured ref,
  // so we don't carry stale hashes from the existing _MAP.md.
  const shallow = await lsTreeShallow(ctx.cfg.target, ctx.cfg.ref, dirRel);
  const freshFiles = new Map<string, string>();
  const freshChildNames: string[] = [];
  for (const e of shallow) {
    if (ctx.ignore && isIgnored(ctx.ignore, e.path, e.type === "tree")) continue;
    const name = posix.basename(e.path);
    if (e.type === "blob") freshFiles.set(name, e.hash);
    else if (e.type === "tree") freshChildNames.push(name);
  }

  // Read file contents from real for the fresh file set.
  const files = await Promise.all(
    [...freshFiles.keys()].map(async (name) => {
      const path = dirRel === "" ? name : posix.join(dirRel, name);
      const content = await gitShow(ctx.cfg.target, ctx.cfg.ref, path).catch(() => "");
      return { name, content };
    }),
  );

  const childSummaries: { name: string; summary: DirSummary }[] = [];
  for (const childName of freshChildNames) {
    const childRel = dirRel === "" ? childName : posix.join(dirRel, childName);
    const summary = await loadChildSummary(ctx, childRel);
    if (summary) childSummaries.push({ name: childName, summary });
  }

  const summary = await summarizeDir({
    dirPath: displayDir(dirRel),
    files,
    childSummaries,
  });

  const dirHash = await gitTreeHash(ctx.cfg.target, ctx.cfg.ref, dirRel);

  const updatedChildren = new Map<string, string | null>();
  for (const childName of freshChildNames) {
    const childRel = dirRel === "" ? childName : posix.join(dirRel, childName);
    const childHash = await gitTreeHash(ctx.cfg.target, ctx.cfg.ref, childRel).catch(() => null);
    updatedChildren.set(childName, childHash);
  }

  await writeMapFile({
    path: mapPath,
    dir: fm.dir,
    status: "scanned",
    syncedAt: new Date().toISOString(),
    dirHash,
    files: freshFiles,
    children: updatedChildren,
    summary,
  });

  ctx.cache.set(dirRel, summary);
  return { scanned: true, summary };
}

async function loadChildSummary(ctx: ScanContext, childRel: string): Promise<DirSummary | undefined> {
  const cached = ctx.cache.get(childRel);
  if (cached) return cached;
  const fm = await readMapFile(mapPathFor(ctx.shadow, childRel)).catch(() => null);
  if (fm?.status !== "scanned") return undefined;
  const parsed = parseSummaryFromBody(fm.body) ?? undefined;
  if (parsed) ctx.cache.set(childRel, parsed);
  return parsed;
}
