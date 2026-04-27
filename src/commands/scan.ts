import { parseArgs } from "../core/args.ts";
import { readConfig } from "../core/config.ts";
import { loadIgnore } from "../core/ignore.ts";
import { absPath } from "../core/paths.ts";
import { depth, displayDir, newScanContext, scanOneDir } from "../core/scanner.ts";
import { walkShadowMaps } from "../core/walk.ts";

export async function scan(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const shadow = flags.shadow ? absPath(String(flags.shadow)) : process.cwd();
  const force = flags.force === true;

  const cfg = await readConfig(shadow).catch(() => {
    throw new Error(`not a couch-potato shadow: ${shadow}`);
  });

  const ig = await loadIgnore(shadow);
  const maps = await walkShadowMaps(shadow);
  // Bottom-up: deepest first so children are scanned before parents.
  maps.sort((a, b) => depth(b.dirRel) - depth(a.dirRel) || a.dirRel.localeCompare(b.dirRel));

  const ctx = newScanContext(shadow, cfg, ig);

  let scanned = 0;
  let skipped = 0;

  for (const m of maps) {
    const result = await scanOneDir(ctx, m.dirRel, { force });
    if (result.scanned) {
      console.log(`scan  ${displayDir(m.dirRel)}`);
      scanned++;
    } else {
      console.log(`skip  ${displayDir(m.dirRel)}  (already scanned)`);
      skipped++;
    }
  }

  console.log("");
  console.log(`done: ${scanned} scanned, ${skipped} skipped`);
}
