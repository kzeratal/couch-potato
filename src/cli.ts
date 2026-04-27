import { init } from "./commands/init.ts";
import { scan } from "./commands/scan.ts";
import { status } from "./commands/status.ts";
import { sync } from "./commands/sync.ts";
import { work } from "./commands/work.ts";

const HELP = `couch-potato — code virtual map for Claude

Usage:
  couch-potato init <real-repo-path> [--shadow <dir>]
  couch-potato scan   [--shadow <dir>] [--scope <subpath>] [--force]
  couch-potato status [--shadow <dir>] [--scope <subpath>]
  couch-potato sync   [--shadow <dir>] [--scope <subpath>]
  couch-potato work   [--real <repo>] [--shadow <dir>] [--skip-sync] [-- <claude args>]

Options:
  --shadow <dir>   Override shadow directory (default: ~/couch-potato/projects/<repo-name>)
  --scope <path>   Limit operation to a subtree (e.g. src/inspector). Coverage grows
                   incrementally as you scope-sync different areas of the same shadow.
  --force          (scan) force rescan of already-scanned dirs
  --skip-sync      (work) don't auto-sync after claude exits
  --print-prompt   (work) print the system prompt that would be injected and exit
  -h, --help       Show this help

Notes:
  'couch-potato work' forwards any unrecognized flag/arg to the spawned
  'claude' process. So 'couch-potato work -c' runs 'claude -c' (resume last
  session in this repo). Use '--' to escape disambiguation if needed.
`;

export async function run(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(HELP);
    return;
  }

  switch (cmd) {
    case "init":
      await init(rest);
      return;
    case "scan":
      await scan(rest);
      return;
    case "status":
      await status(rest);
      return;
    case "sync":
      await sync(rest);
      return;
    case "work":
      await work(rest);
      return;
    default:
      throw new Error(`unknown command: ${cmd}\n\n${HELP}`);
  }
}
