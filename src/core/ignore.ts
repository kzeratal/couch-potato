import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ignoreLib, { type Ignore } from "ignore";

const IGNORE_REL = ".couch-potato/ignore";

export function ignorePath(shadow: string): string {
  return join(shadow, IGNORE_REL);
}

export const DEFAULT_IGNORE_TEMPLATE = `# couch-potato ignore patterns (gitignore syntax)
#
# Paths matching any pattern below are skipped during map generation.
# Edit this file to skip dirs/files that don't help navigation.
# After editing, run \`couch-potato sync\` — already-mirrored dirs that
# now match these patterns will be cleaned up as orphans.

# --- Third-party / vendored code ---
vendor/
third_party/
deps/

# --- Build / output / cache ---
build/
dist/
out/
target/
**/__pycache__/
**/.cache/

# --- Generated code ---
**/generated/
**/*.generated.*
**/*.pb.go
**/*_pb2.py
**/*_pb2_grpc.py

# --- Test fixtures ---
**/testdata/
**/__fixtures__/

# --- Lockfiles (rarely useful for navigation) ---
package-lock.json
yarn.lock
pnpm-lock.yaml
poetry.lock
Cargo.lock
go.sum
`;

/**
 * Read .couch-potato/ignore from `shadow` and return a matcher.
 * Missing file = empty matcher (nothing ignored).
 */
export async function loadIgnore(shadow: string): Promise<Ignore> {
  const ig = ignoreLib();
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
