import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ShadowConfig {
  version: 1;
  target: string;       // absolute path to real repo
  ref: string;          // git ref the shadow tracks (default "HEAD")
  createdAt: string;
}

const CONFIG_REL = ".couch-potato/config.json";

export function configPath(shadow: string): string {
  return join(shadow, CONFIG_REL);
}

export async function writeConfig(shadow: string, cfg: ShadowConfig): Promise<void> {
  const p = configPath(shadow);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export async function readConfig(shadow: string): Promise<ShadowConfig> {
  const raw = await readFile(configPath(shadow), "utf8");
  return JSON.parse(raw) as ShadowConfig;
}
