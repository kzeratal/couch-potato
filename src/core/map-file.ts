import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DirSummary } from "./summarize.ts";

export interface MapFrontmatter {
  dir: string;                       // "/" or "/sub/path"
  status: "placeholder" | "scanned"; // "placeholder" until first scan
  syncedAt: string | null;
  dirHash: string | null;
  files: Map<string, string>;        // filename -> blob hash
  children: Map<string, string | null>; // child dir name -> dir_hash (null if unscanned)
  body: string;                      // content after frontmatter
}

const FENCE = "---";

export async function readMapFile(path: string): Promise<MapFrontmatter> {
  const raw = await readFile(path, "utf8");
  return parseMapFile(raw);
}

export function parseMapFile(raw: string): MapFrontmatter {
  const lines = raw.split("\n");
  if (lines[0] !== FENCE) {
    throw new Error("missing frontmatter fence");
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FENCE) { endIdx = i; break; }
  }
  if (endIdx === -1) throw new Error("unterminated frontmatter");

  const fmLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join("\n");

  let dir = "/";
  let status: "placeholder" | "scanned" = "placeholder";
  let syncedAt: string | null = null;
  let dirHash: string | null = null;
  const files = new Map<string, string>();
  const children = new Map<string, string | null>();

  let section: "top" | "files" | "children" = "top";

  for (const line of fmLines) {
    if (line === "") continue;

    if (!line.startsWith(" ")) {
      // top-level key
      const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
      if (!m) continue;
      const [, key, rawVal] = m;
      const val = (rawVal ?? "").trim();
      switch (key) {
        case "dir": dir = val; section = "top"; break;
        case "status": status = (val === "scanned" ? "scanned" : "placeholder"); section = "top"; break;
        case "synced_at": syncedAt = val === "null" || val === "" ? null : val; section = "top"; break;
        case "dir_hash": dirHash = val === "null" || val === "" ? null : val; section = "top"; break;
        case "files": section = "files"; break;
        case "children": section = "children"; break;
      }
    } else {
      // indented entry
      const m = line.match(/^\s+(\S+):\s*(.*)$/);
      if (!m) continue;
      const [, key, rawVal] = m;
      const val = (rawVal ?? "").trim();
      if (section === "files") {
        files.set(key!, val);
      } else if (section === "children") {
        const name = key!.endsWith("/") ? key!.slice(0, -1) : key!;
        children.set(name, val === "null" || val === "" ? null : val);
      }
    }
  }

  return { dir, status, syncedAt, dirHash, files, children, body };
}

export interface WriteMapInput {
  path: string;             // absolute path to _MAP.md
  dir: string;              // "/" or "/sub/path"
  status: "placeholder" | "scanned";
  syncedAt: string | null;
  dirHash: string | null;
  files: Map<string, string>;
  children: Map<string, string | null>;
  summary: DirSummary | null;
}

export async function writeMapFile(input: WriteMapInput): Promise<void> {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`dir: ${input.dir}`);
  lines.push(`status: ${input.status}`);
  lines.push(`synced_at: ${input.syncedAt ?? "null"}`);
  lines.push(`dir_hash: ${input.dirHash ?? "null"}`);
  lines.push("files:");
  for (const [name, hash] of [...input.files].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${name}: ${hash}`);
  }
  if (input.children.size > 0) {
    lines.push("children:");
    for (const [name, hash] of [...input.children].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`  ${name}/: ${hash ?? "null"}`);
    }
  }
  lines.push("---");
  lines.push("");

  if (input.summary) {
    lines.push(serializeSummary(input.summary));
  } else {
    lines.push("(placeholder — run `couch-potato scan` to fill in summary)");
  }
  lines.push("");

  await mkdir(dirname(input.path), { recursive: true });
  await writeFile(input.path, lines.join("\n"), "utf8");
}

function serializeSummary(s: DirSummary): string {
  const lines: string[] = [];
  lines.push(`purpose: ${s.purpose}`);
  lines.push("entries:");
  if (s.entries.length === 0) lines.push("  []");
  else for (const e of s.entries) lines.push(`  - ${e}`);
  lines.push("deps:");
  if (s.deps.length === 0) lines.push("  []");
  else for (const d of s.deps) lines.push(`  - ${d}`);
  lines.push("gotchas:");
  if (s.gotchas.length === 0) lines.push("  []");
  else for (const g of s.gotchas) lines.push(`  - ${g}`);
  return lines.join("\n");
}

export function parseSummaryFromBody(body: string): DirSummary | null {
  // Reverse of serializeSummary, used to load child summaries during scan.
  const lines = body.split("\n");
  let i = 0;
  // Skip blank lines and the placeholder line.
  while (i < lines.length && (lines[i]!.trim() === "" || lines[i]!.startsWith("("))) i++;
  if (i >= lines.length) return null;

  const purposeMatch = lines[i]?.match(/^purpose:\s*(.*)$/);
  if (!purposeMatch) return null;
  const summary: DirSummary = { purpose: purposeMatch[1]!.trim(), entries: [], deps: [], gotchas: [] };
  i++;

  let section: "entries" | "deps" | "gotchas" | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "entries:") { section = "entries"; continue; }
    if (line === "deps:")    { section = "deps"; continue; }
    if (line === "gotchas:") { section = "gotchas"; continue; }
    const m = line.match(/^\s+-\s+(.*)$/);
    if (m && section) {
      summary[section].push(m[1]!.trim());
    }
  }
  return summary;
}

