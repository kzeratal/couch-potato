import { stat } from "node:fs/promises";
import { posix, relative } from "node:path";
import { parseArgs } from "../core/args.ts";
import { readConfig } from "../core/config.ts";
import { gitExec, lsTree, type TreeEntry } from "../core/git.ts";
import { readMapFile } from "../core/map-file.ts";
import { resolveShadowFromCwd } from "../core/resolve.ts";
import { inScope, normalizeScope } from "../core/scope.ts";
import { walkShadowMaps } from "../core/walk.ts";

type DirState = "PLACEHOLDER" | "FRESH" | "STALE";

interface DirReport {
  dir: string; // "" for root
  state: DirState;
  added: string[];
  removed: string[];
  modified: string[];
}

export async function status(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const shadow = await resolveShadowFromCwd(
    flags.shadow ? String(flags.shadow) : undefined,
  );
  const scope = normalizeScope(flags.scope ? String(flags.scope) : undefined);

  const cfg = await readConfig(shadow).catch(() => {
    throw new Error(`not a couch-potato shadow: ${shadow} (missing .couch-potato/config.json)`);
  });

  const real = cfg.target;
  const realStat = await stat(real).catch(() => null);
  if (!realStat?.isDirectory()) {
    throw new Error(`target repo missing: ${real}`);
  }

  // Detect dirty working tree (we only compare against HEAD).
  const dirty = await isDirty(real);

  // Real repo: collect all blobs grouped by parent dir, scoped if requested.
  const allEntries = await lsTree(real, cfg.ref, scope);
  const realFilesByDir = groupBlobsByDir(allEntries, scope);
  const realDirSet = new Set<string>();
  if (inScope("", scope)) realDirSet.add("");
  for (const e of allEntries) {
    if (!inScope(e.path, scope)) continue;
    if (e.type === "tree") realDirSet.add(e.path);
  }

  // Shadow: collect all _MAP.md files, filtered by scope.
  const allShadowMaps = await walkShadowMaps(shadow);
  const shadowMaps = allShadowMaps.filter((m) => inScope(m.dirRel, scope));
  const shadowDirSet = new Set(shadowMaps.map((m) => m.dirRel));

  const reports: DirReport[] = [];
  for (const m of shadowMaps) {
    const fm = await readMapFile(m.absPath);
    const realFiles = realFilesByDir.get(m.dirRel) ?? new Map<string, string>();
    const report = diffDir(m.dirRel, fm.status === "placeholder", fm.files, realFiles);
    reports.push(report);
  }

  // Dirs that exist in real but have no _MAP.md (would need re-init/sync).
  const newDirs = [...realDirSet].filter((d) => !shadowDirSet.has(d)).sort();
  // Dirs that exist in shadow but not in real (orphaned).
  const orphanedDirs = [...shadowDirSet].filter((d) => !realDirSet.has(d)).sort();

  printReport({
    shadow,
    real,
    ref: cfg.ref,
    scope,
    dirty,
    reports: reports.sort((a, b) => a.dir.localeCompare(b.dir)),
    newDirs,
    orphanedDirs,
  });
}

async function isDirty(repo: string): Promise<boolean> {
  try {
    const out = await gitExec(["status", "--porcelain"], repo);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function groupBlobsByDir(entries: TreeEntry[], scope: string): Map<string, Map<string, string>> {
  const m = new Map<string, Map<string, string>>();
  for (const e of entries) {
    if (e.type !== "blob") continue;
    if (!inScope(e.path, scope)) continue;
    const parent = posix.dirname(e.path);
    const key = parent === "." ? "" : parent;
    const name = posix.basename(e.path);
    let inner = m.get(key);
    if (!inner) { inner = new Map(); m.set(key, inner); }
    inner.set(name, e.hash);
  }
  return m;
}

function diffDir(
  dir: string,
  isPlaceholder: boolean,
  recorded: Map<string, string>,
  current: Map<string, string>,
): DirReport {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [name, hash] of current) {
    const prev = recorded.get(name);
    if (prev === undefined) added.push(name);
    else if (prev !== hash) modified.push(name);
  }
  for (const name of recorded.keys()) {
    if (!current.has(name)) removed.push(name);
  }

  added.sort(); removed.sort(); modified.sort();

  let state: DirState;
  if (added.length === 0 && removed.length === 0 && modified.length === 0) {
    state = isPlaceholder ? "PLACEHOLDER" : "FRESH";
  } else {
    state = "STALE";
  }

  return { dir, state, added, removed, modified };
}

function printReport(r: {
  shadow: string;
  real: string;
  ref: string;
  scope: string;
  dirty: boolean;
  reports: DirReport[];
  newDirs: string[];
  orphanedDirs: string[];
}): void {
  const cwd = process.cwd();
  console.log(`shadow:  ${relative(cwd, r.shadow) || "."}`);
  console.log(`target:  ${r.real} @ ${r.ref}${r.scope ? `  (--scope /${r.scope})` : ""}`);
  if (r.dirty) {
    console.log(`warning: target has uncommitted changes — comparing against ${r.ref} only`);
  }
  console.log("");

  let placeholder = 0, fresh = 0, stale = 0;

  for (const rep of r.reports) {
    const label = rep.dir === "" ? "/" : "/" + rep.dir + "/";
    const tag = rep.state;
    console.log(`  ${tag.padEnd(11)} ${label}`);
    for (const f of rep.modified) console.log(`              M ${f}`);
    for (const f of rep.added)    console.log(`              + ${f}`);
    for (const f of rep.removed)  console.log(`              - ${f}`);

    if (rep.state === "PLACEHOLDER") placeholder++;
    else if (rep.state === "FRESH")  fresh++;
    else                             stale++;
  }

  if (r.newDirs.length > 0) {
    console.log("");
    console.log("new directories in target (no _MAP.md yet):");
    for (const d of r.newDirs) console.log(`  + /${d}/`);
  }
  if (r.orphanedDirs.length > 0) {
    console.log("");
    console.log("orphaned _MAP.md (directory removed from target):");
    for (const d of r.orphanedDirs) console.log(`  - /${d}/`);
  }

  console.log("");
  const parts: string[] = [];
  if (fresh)       parts.push(`${fresh} fresh`);
  if (stale)       parts.push(`${stale} stale`);
  if (placeholder) parts.push(`${placeholder} placeholder`);
  if (r.newDirs.length)      parts.push(`${r.newDirs.length} new dir(s)`);
  if (r.orphanedDirs.length) parts.push(`${r.orphanedDirs.length} orphaned`);
  console.log(parts.length ? parts.join(", ") : "no maps found");
}
