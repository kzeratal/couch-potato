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

  // Child summaries from cache (assumes bottom-up order).
  const childSummaries: { name: string; summary: DirSummary }[] = [];
  for (const childName of freshChildNames) {
    const childRel = dirRel === "" ? childName : posix.join(dirRel, childName);
    const summary = ctx.cache.get(childRel);
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
