import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";

export function defaultShadowFor(realRepoPath: string): string {
  const name = basename(realRepoPath);
  return resolve(homedir(), "couch-potato", "projects", name);
}

export function projectsRoot(): string {
  return resolve(homedir(), "couch-potato", "projects");
}

export function absPath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}
