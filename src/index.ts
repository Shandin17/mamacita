import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { runOnce } from "./run.ts";

// PRD §2 tracer bullet entry point: load config, run a single pass, exit cleanly.
async function main(): Promise<void> {
  const configPath = resolve(
    process.env.CONFIG_PATH ?? "config.json",
  );

  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    // A missing file is fine if everything is supplied via env overrides.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    console.warn(`[config] ${configPath} not found — relying on env overrides`);
  }

  const config = loadConfig(raw, process.env);
  const log = (m: string) =>
    console.log(`[${new Date().toISOString()}] ${m}`);

  const result = await runOnce(config, { log });
  log(`single pass complete (hit=${result.hit})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });
