import { parseArgs } from "../core/args.ts";
import { readConfig } from "../core/config.ts";
import { loadIgnore } from "../core/ignore.ts";
import { absPath } from "../core/paths.ts";
import { newScanContext, scanWaves } from "../core/scanner.ts";
import { inScope, normalizeScope } from "../core/scope.ts";
import { walkShadowMaps } from "../core/walk.ts";

export async function scan(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const shadow = flags.shadow ? absPath(String(flags.shadow)) : process.cwd();
  const force = flags.force === true;
  const scope = normalizeScope(flags.scope ? String(flags.scope) : undefined);
  const concurrency = flags.concurrency ? Number(flags.concurrency) : 8;

  const cfg = await readConfig(shadow).catch(() => {
    throw new Error(`not a couch-potato shadow: ${shadow}`);
  });

  const ig = await loadIgnore(shadow);
  const allMaps = await walkShadowMaps(shadow);
  const dirs = allMaps.filter((m) => inScope(m.dirRel, scope)).map((m) => m.dirRel);

  const ctx = newScanContext(shadow, cfg, ig);
  const { scanned } = await scanWaves(ctx, dirs, { force, concurrency });

  console.log("");
  console.log(`done: ${scanned} scanned, ${dirs.length - scanned} skipped (concurrency: ${concurrency})`);
}
