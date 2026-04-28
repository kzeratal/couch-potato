import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DirSummary } from "./summarize.ts";

export interface MapFrontmatter {
  dir: string;
  status: "placeholder" | "scanned";
  body: string;
}

export interface MapMeta {
  syncedAt: string | null;
  dirHash: string | null;
  files: Map<string, string>;
  children: Map<string, string | null>;
}

const FENCE = "---";

export function metaPathFor(mapPath: string): string {
  return mapPath.replace(/_MAP\.md$/, "_MAP.meta.json");
}

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

  for (const line of fmLines) {
    if (line === "" || line.startsWith(" ")) continue;
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    const val = (rawVal ?? "").trim();
    if (key === "dir") dir = val;
    else if (key === "status") status = val === "scanned" ? "scanned" : "placeholder";
  }

  return { dir, status, body };
}

export async function readMapMeta(mapPath: string): Promise<MapMeta | null> {
  let raw: string;
  try {
    raw = await readFile(metaPathFor(mapPath), "utf8");
  } catch {
    return null;
  }
  const obj = JSON.parse(raw);
  return {
    syncedAt: obj.syncedAt ?? null,
    dirHash: obj.dirHash ?? null,
    files: new Map(Object.entries(obj.files ?? {}) as [string, string][]),
    children: new Map(
      Object.entries(obj.children ?? {}).map(
        ([k, v]) => [k, v == null ? null : String(v)] as const,
      ),
    ),
  };
}

export async function writeMapMeta(mapPath: string, meta: MapMeta): Promise<void> {
  const obj = {
    syncedAt: meta.syncedAt,
    dirHash: meta.dirHash,
    files: Object.fromEntries(
      [...meta.files].sort(([a], [b]) => a.localeCompare(b)),
    ),
    children: Object.fromEntries(
      [...meta.children].sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  await mkdir(dirname(mapPath), { recursive: true });
  await writeFile(metaPathFor(mapPath), JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export interface WriteMapInput {
  path: string;             // absolute path to _MAP.md
  dir: string;              // "/" or "/sub/path"
  status: "placeholder" | "scanned";
  summary: DirSummary | null;
}

export async function writeMapFile(input: WriteMapInput): Promise<void> {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`dir: ${input.dir}`);
  lines.push(`status: ${input.status}`);
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
