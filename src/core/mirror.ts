import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { Ignore } from "ignore";
import { lsTree, type TreeEntry } from "./git.ts";
import { isIgnored } from "./ignore.ts";

export interface MirrorPlan {
  dirs: string[];        // posix-style paths relative to repo root, "" = root
  files: TreeEntry[];    // blob entries (paths repo-relative)
}

export async function planMirror(
  realRepo: string,
  ref = "HEAD",
  ig?: Ignore,
): Promise<MirrorPlan> {
  const entries = await lsTree(realRepo, ref);
  const dirs = new Set<string>([""]);
  const files: TreeEntry[] = [];

  for (const e of entries) {
    if (ig && isIgnored(ig, e.path, e.type === "tree")) continue;
    if (e.type === "tree") dirs.add(e.path);
    else if (e.type === "blob") {
      files.push(e);
      const parent = posix.dirname(e.path);
      if (parent !== ".") dirs.add(parent);
    }
  }

  return { dirs: [...dirs].sort(), files };
}

export async function materializeDirs(shadow: string, dirs: string[]): Promise<void> {
  for (const d of dirs) {
    const full = d === "" ? shadow : join(shadow, d);
    await mkdir(full, { recursive: true });
  }
}

export function mapPathFor(shadow: string, dirRel: string): string {
  return dirRel === "" ? join(shadow, "_MAP.md") : join(shadow, dirRel, "_MAP.md");
}

export async function writePlaceholderMap(
  mapPath: string,
  dirRel: string,
  files: TreeEntry[],
  childDirs: string[],
): Promise<void> {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`dir: ${dirRel === "" ? "/" : "/" + dirRel}`);
  lines.push("status: placeholder");
  lines.push("synced_at: null");
  lines.push("dir_hash: null");
  lines.push("files:");
  for (const f of files) {
    const name = f.path.slice(dirRel === "" ? 0 : dirRel.length + 1);
    lines.push(`  ${name}: ${f.hash}`);
  }
  if (childDirs.length > 0) {
    lines.push("children:");
    for (const c of childDirs) {
      lines.push(`  ${c}/: null`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push("(placeholder — run `couch-potato scan` to fill in summary)");
  lines.push("");
  await mkdir(dirname(mapPath), { recursive: true });
  await writeFile(mapPath, lines.join("\n"), "utf8");
}
