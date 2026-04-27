import { spawn } from "node:child_process";

export interface DirSummary {
  purpose: string;
  entries: string[];
  deps: string[];
  gotchas: string[];
}

export interface SummarizeInput {
  dirPath: string;                                  // "/" or "/sub/path"
  files: { name: string; content: string }[];       // direct files in this dir
  childSummaries: { name: string; summary: DirSummary }[]; // already-scanned children
}

const MODEL = "haiku";
const MAX_FILE_CHARS = 12_000;

const SYSTEM_PROMPT = `You are summarizing a single directory of a code repository so another AI agent can navigate the codebase efficiently.

Be terse — this is read by an LLM, not a human. Skip information that is obvious from the file names. Do not explore files, do not run tools — base your answer purely on the prompt content.

Schema fields:
- purpose: One sentence. What this directory's role is in the overall system.
- entries: Public/external symbols (functions, classes, exported types, HTTP routes, CLI commands) that callers OUTSIDE this directory would invoke. Skip helpers and internal-only symbols.
- deps: Important dependencies — other directories in this repo, or notable external packages. Use repo-relative paths for internal deps. Skip ubiquitous deps (stdlib, common test libs).
- gotchas: Non-obvious constraints, invariants, ordering requirements, or surprising behavior that an agent reading the code casually would miss. Empty list is fine if nothing notable.

Return ONLY the structured object that matches the schema.`;

const SCHEMA = {
  type: "object",
  properties: {
    purpose: { type: "string" },
    entries: { type: "array", items: { type: "string" } },
    deps:    { type: "array", items: { type: "string" } },
    gotchas: { type: "array", items: { type: "string" } },
  },
  required: ["purpose", "entries", "deps", "gotchas"],
  additionalProperties: false,
};

export async function summarizeDir(input: SummarizeInput): Promise<DirSummary> {
  const prompt = renderUserPrompt(input);
  const raw = await runClaudeWithSchema(prompt);
  return normalize(raw);
}

interface ClaudeJsonResponse {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
}

async function runClaudeWithSchema(userPrompt: string): Promise<unknown> {
  const args = [
    "-p",
    "--model", MODEL,
    "--output-format", "json",
    "--json-schema", JSON.stringify(SCHEMA),
    "--append-system-prompt", SYSTEM_PROMPT,
    "--no-session-persistence",
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as ClaudeJsonResponse;
        if (parsed.is_error) {
          reject(new Error(`claude -p reported error: ${parsed.result ?? stdout}`));
          return;
        }
        if (parsed.structured_output === undefined) {
          reject(new Error(`claude -p response missing structured_output: ${stdout.slice(0, 500)}`));
          return;
        }
        resolve(parsed.structured_output);
      } catch (err) {
        reject(new Error(`failed to parse claude -p output: ${(err as Error).message}\n${stdout.slice(0, 500)}`));
      }
    });

    proc.stdin.write(userPrompt);
    proc.stdin.end();
  });
}

function renderUserPrompt(input: SummarizeInput): string {
  const parts: string[] = [];
  parts.push(`Directory: ${input.dirPath}`);
  parts.push("");

  if (input.childSummaries.length > 0) {
    parts.push("## Child directory summaries (already analyzed):");
    parts.push("");
    for (const c of input.childSummaries) {
      parts.push(`### ${c.name}/`);
      parts.push(`purpose: ${c.summary.purpose}`);
      if (c.summary.entries.length) parts.push(`entries: ${c.summary.entries.join(", ")}`);
      if (c.summary.deps.length)    parts.push(`deps: ${c.summary.deps.join(", ")}`);
      if (c.summary.gotchas.length) parts.push(`gotchas: ${c.summary.gotchas.join("; ")}`);
      parts.push("");
    }
  }

  if (input.files.length > 0) {
    parts.push("## Files directly in this directory:");
    parts.push("");
    for (const f of input.files) {
      const content = f.content.length > MAX_FILE_CHARS
        ? f.content.slice(0, MAX_FILE_CHARS) + "\n\n... [truncated]"
        : f.content;
      parts.push(`### ${f.name}`);
      parts.push("```");
      parts.push(content);
      parts.push("```");
      parts.push("");
    }
  } else {
    parts.push("(no direct files — only subdirectories)");
  }

  parts.push("");
  parts.push("Summarize this directory using the required schema.");
  return parts.join("\n");
}

function normalize(raw: unknown): DirSummary {
  const r = (raw ?? {}) as Partial<DirSummary>;
  return {
    purpose: typeof r.purpose === "string" ? r.purpose.trim() : "",
    entries: Array.isArray(r.entries) ? r.entries.map(String) : [],
    deps:    Array.isArray(r.deps)    ? r.deps.map(String)    : [],
    gotchas: Array.isArray(r.gotchas) ? r.gotchas.map(String) : [],
  };
}
