import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { configPath, readConfig, type ShadowConfig } from "./config.ts";
import { gitToplevel, isGitRepo } from "./git.ts";
import { absPath, defaultShadowFor, projectsRoot } from "./paths.ts";

export async function resolveReal(input: string | undefined): Promise<string> {
  const start = input ? absPath(input) : process.cwd();
  const s = await stat(start).catch(() => null);
  if (!s?.isDirectory()) {
    throw new Error(`not a directory: ${start}`);
  }
  if (!(await isGitRepo(start))) {
    throw new Error(`not a git repo: ${start}\n(must be run inside a git repository)`);
  }
  return await gitToplevel(start);
}

/**
 * Find the shadow that targets `real`. Priority:
 *   1. Default-named shadow (~/couch-potato/projects/<basename>)
 *   2. Scan ~/couch-potato/projects/* for any whose config.target matches.
 */
export async function resolveShadow(real: string): Promise<string> {
  const def = defaultShadowFor(real);
  if (await isShadowFor(def, real)) return def;

  const root = projectsRoot();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    throw new Error(
      `no shadow found for ${real}\n(run \`couch-potato init ${real}\` first)`,
    );
  }
  for (const name of entries) {
    const candidate = join(root, name);
    if (await isShadowFor(candidate, real)) return candidate;
  }
  throw new Error(
    `no shadow found for ${real}\n(run \`couch-potato init ${real}\` first)`,
  );
}

export async function isShadowFor(shadow: string, real: string): Promise<boolean> {
  try {
    const cfg = JSON.parse(await readFile(configPath(shadow), "utf8")) as ShadowConfig;
    return cfg.target === real;
  } catch {
    return false;
  }
}

/**
 * Resolve the shadow path for sync/scan/status. Order:
 *   1. Explicit `--shadow <path>` flag → use it verbatim (validation happens later).
 *   2. cwd is itself a shadow (has .couch-potato/config.json) → use cwd.
 *   3. cwd is inside a git repo → resolve via projectsRoot lookup.
 *   4. Otherwise throw with guidance.
 */
export async function resolveShadowFromCwd(shadowFlag: string | undefined): Promise<string> {
  if (shadowFlag) return absPath(shadowFlag);

  const cwd = process.cwd();
  if (await readConfig(cwd).then(() => true, () => false)) {
    return cwd;
  }

  if (!(await isGitRepo(cwd))) {
    throw new Error(
      `couldn't resolve shadow:\n` +
      `  ${cwd} is neither a couch-potato shadow nor inside a git repo.\n` +
      `(cd into a real repo, pass --shadow <path>, or run \`couch-potato init <repo>\`)`,
    );
  }

  const real = await gitToplevel(cwd);
  return await resolveShadow(real);
}
