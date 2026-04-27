import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface ShadowMapEntry {
  dirRel: string;   // posix-style path relative to shadow ("" for root)
  absPath: string;  // absolute path of _MAP.md
}

const SKIP_DIRS = new Set([".couch-potato", ".git"]);

export async function walkShadowMaps(shadow: string): Promise<ShadowMapEntry[]> {
  const out: ShadowMapEntry[] = [];
  await walk(shadow, shadow, out);
  return out;
}

async function walk(root: string, dir: string, out: ShadowMapEntry[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  const hasMap = entries.some((e) => e.isFile() && e.name === "_MAP.md");
  if (hasMap) {
    const rel = relative(root, dir).split(sep).join("/");
    out.push({ dirRel: rel, absPath: join(dir, "_MAP.md") });
  }

  for (const e of entries) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) {
      await walk(root, join(dir, e.name), out);
    }
  }
}
