import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ignoreLib, { type Ignore } from "ignore";

const IGNORE_REL = ".couch-potato/ignore";

export function ignorePath(shadow: string): string {
  return join(shadow, IGNORE_REL);
}

// Always-on patterns: scanning these is pure waste, no judgment call needed.
// Applied before the user's ignore file, so the user can still escape with
// gitignore-style negation (e.g. \`!node_modules/\`).
const HARDCODED_IGNORE = `node_modules/
**/__pycache__/
.DS_Store
*.pyc
*.pyo
`;

export const DEFAULT_IGNORE_TEMPLATE = `# couch-potato ignore patterns (gitignore syntax)
#
# Files in your repo's .gitignore are already invisible to couch-potato
# (we read via \`git ls-tree\`), so don't repeat those here. Add patterns
# only for files that ARE tracked but unhelpful for code navigation.
#
# A small set of universally-useless patterns (node_modules, __pycache__,
# .DS_Store, *.pyc) is hardcoded and always applied — you don't need to
# list them. Use \`!pattern\` to escape any of them if you really need to.
#
# After editing, run \`couch-potato sync\` — already-mirrored dirs that
# now match these patterns will be cleaned up as orphans.

# --- Lockfiles (tracked, but rarely useful for navigation) ---
package-lock.json
yarn.lock
pnpm-lock.yaml
poetry.lock
Pipfile.lock
Cargo.lock
go.sum
bun.lock

# --- Vendored / third-party code (typically committed, so .gitignore
# doesn't cover it — but huge dirs blow past LLM context windows) ---
vendor/
third_party/
3rd_party/
deps/
`;

/**
 * Read .couch-potato/ignore from `shadow` and return a matcher.
 * Missing file = empty matcher (nothing ignored).
 */
export async function loadIgnore(shadow: string): Promise<Ignore> {
  const ig = ignoreLib();
  ig.add(HARDCODED_IGNORE);
  const content = await readFile(ignorePath(shadow), "utf8").catch(() => "");
  if (content) ig.add(content);
  return ig;
}

/**
 * Write the default ignore template to `<shadow>/.couch-potato/ignore`.
 * No-op if the file already exists (preserves user edits).
 */
export async function writeDefaultIgnore(shadow: string): Promise<void> {
  const path = ignorePath(shadow);
  const exists = await readFile(path, "utf8").then(() => true).catch(() => false);
  if (exists) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, DEFAULT_IGNORE_TEMPLATE, "utf8");
}

/**
 * Convenience: filter a tree-entry path. Treats trees with trailing slash so
 * dir-only gitignore patterns (e.g. `vendor/`) match correctly.
 */
export function isIgnored(ig: Ignore, path: string, isDir: boolean): boolean {
  if (path === "") return false;
  return ig.ignores(isDir ? path + "/" : path);
}
