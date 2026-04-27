import { spawn } from "node:child_process";

export async function gitExec(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
    });
  });
}

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    const out = await gitExec(["rev-parse", "--is-inside-work-tree"], path);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

export async function gitToplevel(path: string): Promise<string> {
  const out = await gitExec(["rev-parse", "--show-toplevel"], path);
  return out.trim();
}

export interface TreeEntry {
  mode: string;
  type: "blob" | "tree";
  hash: string;
  path: string;
}

export async function gitShow(repoPath: string, ref: string, path: string): Promise<string> {
  return gitExec(["show", `${ref}:${path}`], repoPath);
}

export async function gitTreeHash(repoPath: string, ref: string, path: string): Promise<string> {
  const args = path === ""
    ? ["rev-parse", `${ref}^{tree}`]
    : ["rev-parse", `${ref}:${path}`];
  const out = await gitExec(args, repoPath);
  return out.trim();
}

export async function lsTree(repoPath: string, ref = "HEAD", subpath = ""): Promise<TreeEntry[]> {
  const args = ["ls-tree", "-r", "-t", ref];
  if (subpath) args.push("--", subpath);
  const out = await gitExec(args, repoPath);
  return parseLsTree(out);
}

/**
 * Non-recursive ls-tree of a directory. Returns the direct entries
 * (files and immediate subdirs) of `dirRel` at `ref`. Empty `dirRel` = root.
 * Paths in the returned entries are full repo-relative paths.
 */
export async function lsTreeShallow(repoPath: string, ref: string, dirRel: string): Promise<TreeEntry[]> {
  const target = dirRel === "" ? `${ref}` : `${ref}:${dirRel}`;
  const args = ["ls-tree", target];
  const out = await gitExec(args, repoPath);
  // ls-tree of a tree object returns paths relative to that tree.
  // Re-prefix with dirRel so callers see full repo-relative paths.
  return parseLsTree(out).map((e) => ({
    ...e,
    path: dirRel === "" ? e.path : `${dirRel}/${e.path}`,
  }));
}

function parseLsTree(out: string): TreeEntry[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      const [mode, type, hash] = meta!.split(" ");
      return { mode: mode!, type: type as "blob" | "tree", hash: hash!, path: path! };
    });
}
