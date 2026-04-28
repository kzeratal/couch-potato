import pkg from "../../package.json" with { type: "json" };

export function version(): void {
  process.stdout.write(`couch-potato ${pkg.version}\n`);
}
