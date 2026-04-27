/**
 * A "scope" is a runtime filter limiting which directories an operation
 * (scan / sync / status) acts on. It is NOT persisted in shadow config.
 * The shadow always mirrors the full repo; scope just selects a subtree
 * of it to operate on, so coverage can grow incrementally.
 */

/**
 * Normalize a user-provided scope arg: trim, strip leading/trailing slashes.
 * Returns "" for empty / whole-repo.
 */
export function normalizeScope(s: string | undefined): string {
  if (!s) return "";
  let v = s.trim();
  while (v.startsWith("/") || v.startsWith("./")) v = v.startsWith("./") ? v.slice(2) : v.slice(1);
  while (v.endsWith("/")) v = v.slice(0, -1);
  return v;
}

/**
 * Test whether a repo-relative path falls within a scope subtree.
 *   inScope("src/foo/bar", "src/foo") → true
 *   inScope("src/foo",     "src/foo") → true
 *   inScope("src/other",   "src/foo") → false
 *   inScope(anything,      "")        → true
 *   inScope("",            "")        → true
 *   inScope("",            "src/foo") → false (root not in subtree scope)
 */
export function inScope(dirRel: string, scope: string): boolean {
  if (scope === "") return true;
  if (dirRel === scope) return true;
  return dirRel.startsWith(scope + "/");
}
