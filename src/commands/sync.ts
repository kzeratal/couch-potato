import { rm, rmdir } from "node:fs/promises";
import { dirname, posix } from "node:path";
import { parseArgs } from "../core/args.ts";
import { readConfig } from "../core/config.ts";
import { gitTreeHash, lsTree, type TreeEntry } from "../core/git.ts";
import { isIgnored, loadIgnore } from "../core/ignore.ts";
import { readMapFile } from "../core/map-file.ts";
import {
  mapPathFor,
  materializeDirs,
  planMirror,
  writePlaceholderMap,
} from "../core/mirror.ts";
import { resolveShadowFromCwd } from "../core/resolve.ts";
import { displayDir, newScanContext, scanWaves } from "../core/scanner.ts";
import { inScope, normalizeScope } from "../core/scope.ts";
import { walkShadowMaps } from "../core/walk.ts";

export async function sync(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const shadow = await resolveShadowFromCwd(
    flags.shadow ? String(flags.shadow) : undefined,
  );
  const scope = normalizeScope(flags.scope ? String(flags.scope) : undefined);
  const concurrency = flags.concurrency ? Number(flags.concurrency) : 8;

  const cfg = await readConfig(shadow).catch(() => {
    throw new Error(`not a couch-potato shadow: ${shadow}`);
  });

  const ig = await loadIgnore(shadow);

  // 1. Index shadow (filtered by --scope if given).
  const allShadowMaps = await walkShadowMaps(shadow);
  const shadowMaps = allShadowMaps.filter((m) => inScope(m.dirRel, scope));
  const shadowDirSet = new Set(shadowMaps.map((m) => m.dirRel));

  // 2. Index real repo (filtered by --scope and ignore patterns — ignored
  // paths become invisible to the real-side, naturally turning matching
  // shadow entries into orphans on next sync).
  const realEntries = await lsTree(cfg.target, cfg.ref, scope);
  const realDirSet = new Set<string>();
  if (inScope("", scope)) realDirSet.add("");
  let ignoredCount = 0;
  for (const e of realEntries) {
    if (isIgnored(ig, e.path, e.type === "tree")) { ignoredCount++; continue; }
    if (!inScope(e.path, scope)) continue;
    if (e.type === "tree") realDirSet.add(e.path);
  }

  // 3. Classify dirs.
  const orphanDirs = [...shadowDirSet].filter((d) => !realDirSet.has(d));
  const newDirs    = [...realDirSet].filter((d) => !shadowDirSet.has(d));

  // 4. Detect stale dirs via dir_hash comparison.
  // git tree hash is derived from sorted (mode+type+hash+name) entries,
  // so a matching dir_hash mathematically implies all per-file hashes match too.
  const staleDirs: string[] = [];
  for (const m of shadowMaps) {
    if (orphanDirs.includes(m.dirRel)) continue;
    const fm = await readMapFile(m.absPath);
    if (fm.status === "placeholder") {
      staleDirs.push(m.dirRel);
      continue;
    }
    const realHash = await gitTreeHash(cfg.target, cfg.ref, m.dirRel).catch(() => null);
    if (!realHash || realHash !== fm.dirHash) staleDirs.push(m.dirRel);
  }

  // 5. Affected = stale ∪ new ∪ (ancestors of stale ∪ new ∪ orphan, restricted to scope).
  const affected = new Set<string>([...staleDirs, ...newDirs]);
  for (const d of [...staleDirs, ...newDirs, ...orphanDirs]) {
    for (const a of ancestors(d)) {
      if (inScope(a, scope) && realDirSet.has(a)) affected.add(a);
    }
  }

  console.log(`shadow:  ${shadow}`);
  console.log(`target:  ${cfg.target} @ ${cfg.ref}${scope ? `  (--scope /${scope})` : ""}`);
  if (ignoredCount > 0) {
    console.log(`ignored: ${ignoredCount} entries (.couch-potato/ignore)`);
  }
  console.log("");
  console.log(`stale:   ${staleDirs.length}`);
  console.log(`new:     ${newDirs.length}`);
  console.log(`orphan:  ${orphanDirs.length}`);
  console.log(`affected (incl. ancestors): ${affected.size}`);
  console.log("");

  if (affected.size === 0 && orphanDirs.length === 0) {
    console.log("nothing to do — shadow is in sync.");
    return;
  }

  // 6. Delete orphans first.
  for (const d of orphanDirs) {
    const mapPath = mapPathFor(shadow, d);
    await rm(mapPath, { force: true });
    // Try removing the now-empty shadow dir; ignore if non-empty.
    try { await rmdir(dirname(mapPath)); } catch { /* not empty */ }
    console.log(`del   ${displayDir(d)}  (orphan)`);
  }

  // 7. Bootstrap new dirs (mkdir + placeholder _MAP.md with file hashes).
  if (newDirs.length > 0) {
    const plan = await planMirror(cfg.target, cfg.ref, ig);
    await materializeDirs(shadow, newDirs);

    const filesByDir = groupFilesByDir(plan.files);
    const childrenByDir = groupChildrenByDir(plan.dirs);

    for (const d of newDirs) {
      const files = filesByDir.get(d) ?? [];
      const children = (childrenByDir.get(d) ?? []).sort();
      await writePlaceholderMap(mapPathFor(shadow, d), d, files, children);
      console.log(`init  ${displayDir(d)}  (new dir, ${files.length} files)`);
    }
  }

  // 8. Wave-parallel scan: dirs at the same depth run concurrently
  // (bounded by --concurrency); deeper waves finish before shallower
  // ones start so parents find child summaries in cache.
  const ctx = newScanContext(shadow, cfg, ig);
  const { scanned: rescanned } = await scanWaves(ctx, [...affected], {
    force: true,
    concurrency,
  });

  console.log("");
  console.log(`done: ${rescanned} rescanned, ${orphanDirs.length} deleted (concurrency: ${concurrency})`);
}

function ancestors(dirRel: string): string[] {
  if (dirRel === "") return [];
  const parts = dirRel.split("/");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(parts.slice(0, i).join("/"));
  }
  return out;
}

function groupFilesByDir(files: TreeEntry[]): Map<string, TreeEntry[]> {
  const m = new Map<string, TreeEntry[]>();
  for (const f of files) {
    const parent = posix.dirname(f.path);
    const key = parent === "." ? "" : parent;
    let arr = m.get(key);
    if (!arr) { arr = []; m.set(key, arr); }
    arr.push(f);
  }
  return m;
}

function groupChildrenByDir(dirs: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const d of dirs) {
    if (d === "") continue;
    const parent = posix.dirname(d);
    const key = parent === "." ? "" : parent;
    const childName = posix.basename(d);
    let arr = m.get(key);
    if (!arr) { arr = []; m.set(key, arr); }
    arr.push(childName);
  }
  return m;
}
