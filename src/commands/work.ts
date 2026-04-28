import { spawn } from "node:child_process";
import { readConfig } from "../core/config.ts";
import { absPath } from "../core/paths.ts";
import { resolveReal, resolveShadow } from "../core/resolve.ts";

interface WorkArgs {
  shadow?: string;
  real?: string;
  printPrompt: boolean;
  passThrough: string[];
}

/**
 * Custom parser for `work` so unrecognized flags (e.g. -c, --continue,
 * --resume, --fork-session) are forwarded verbatim to the spawned `claude`.
 * Use `--` to force everything after to be passed through unchanged.
 */
function parseWorkArgs(argv: string[]): WorkArgs {
  const out: WorkArgs = { printPrompt: false, passThrough: [] };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === "--") {
      out.passThrough.push(...argv.slice(i + 1));
      break;
    }
    if (a === "--shadow") { out.shadow = argv[++i]; i++; continue; }
    if (a === "--real")   { out.real   = argv[++i]; i++; continue; }
    if (a === "--print-prompt") { out.printPrompt = true; i++; continue; }
    // Anything else is for claude.
    out.passThrough.push(a);
    i++;
  }
  return out;
}

export async function work(argv: string[]): Promise<void> {
  const args = parseWorkArgs(argv);

  const real = await resolveReal(args.real);

  const shadow = args.shadow
    ? absPath(args.shadow)
    : await resolveShadow(real);

  const cfg = await readConfig(shadow).catch(() => {
    throw new Error(`shadow has no config: ${shadow}`);
  });
  if (cfg.target !== real) {
    throw new Error(
      `shadow target mismatch:\n  shadow says: ${cfg.target}\n  CWD/repo:    ${real}\n` +
      `(use --shadow to override or run \`couch-potato init\` for this repo)`,
    );
  }

  const { printPrompt, passThrough } = args;

  const systemPrompt = buildSystemPrompt(shadow);

  if (printPrompt) {
    process.stdout.write(systemPrompt);
    return;
  }

  console.log(`real:    ${real}`);
  console.log(`shadow:  ${shadow}`);
  console.log(`prompt:  ${approxTokens(systemPrompt)} approx tokens (lazy-load: Claude reads _MAP.md on demand)`);
  if (passThrough.length > 0) {
    console.log(`forward: ${passThrough.join(" ")}`);
  }

  if (resumesPriorConversation(passThrough)) {
    console.log("");
    console.log("⚠️  warning: -c/--continue resumes a prior conversation.");
    console.log("   --append-system-prompt only applies to NEW conversations,");
    console.log("   so the resumed Claude may not see the map instructions and");
    console.log("   will likely fall back to grep/glob/read on real source.");
    console.log("   For a true couch-potato session, omit -c.");
  }
  console.log("");

  await spawnClaude({ cwd: real, systemPrompt, shadow, extraArgs: passThrough });
}

function buildSystemPrompt(shadow: string): string {
  return `# couch-potato

Maps at \`${shadow}/<dir>/_MAP.md\` (purpose / entries / deps / gotchas):
- Read before grep/glob on source for orientation.
- Shadow is read-only — edit in CWD.
- Subagents don't inherit this; pass them the shadow path and tell them to Read \`_MAP.md\` first.
`;
}

function spawnClaude(opts: {
  cwd: string;
  systemPrompt: string;
  shadow: string;
  extraArgs: string[];
}): Promise<void> {
  const args = [
    "--append-system-prompt", opts.systemPrompt,
    "--add-dir", opts.shadow,
    ...opts.extraArgs,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, { cwd: opts.cwd, stdio: "inherit" });
    proc.on("error", (err) => {
      reject(new Error(`failed to spawn claude: ${err.message} (is it on PATH?)`));
    });
    proc.on("close", (code) => {
      if (code === 0 || code === null) resolve();
      else resolve(); // claude exited non-zero (user Ctrl-C etc.); still run sync
    });
  });
}

function approxTokens(s: string): number {
  // Rough heuristic: ~4 chars per token.
  return Math.ceil(s.length / 4);
}

function resumesPriorConversation(passThrough: string[]): boolean {
  for (const a of passThrough) {
    if (a === "-c" || a === "--continue" || a === "--resume" || a === "--from-pr") return true;
  }
  return false;
}
