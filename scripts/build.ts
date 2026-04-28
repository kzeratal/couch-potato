#!/usr/bin/env bun
import { chmod, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const OUT = "dist/couch-potato.js";

await new Promise<void>((resolve, reject) => {
  const p = spawn(
    "bun",
    ["build", "bin/couch-potato.ts", "--target=node", "--outfile", OUT],
    { stdio: "inherit" },
  );
  p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`bun build exited ${code}`))));
});

// Bun preserves the source's #!/usr/bin/env bun shebang, but the published
// bundle runs under Node (npx user). Rewrite to a Node shebang.
const raw = await readFile(OUT, "utf8");
const fixed = raw.replace(/^#![^\n]*\n/, "#!/usr/bin/env node\n");
await writeFile(OUT, fixed, "utf8");
await chmod(OUT, 0o755);

console.log(`built ${OUT} (${fixed.length} bytes)`);
