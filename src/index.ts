import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { runLoop } from "./loop.ts";

// PRD §FR1/§FR4 production entry point: load config, then run the continuous
// jittered, time-gated polling loop over the full §3.4 target matrix.
async function main(): Promise<void> {
  const configPath = resolve(process.env.CONFIG_PATH ?? "config.json");

  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    // A missing file is fine if everything is supplied via env overrides.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    console.warn(`[config] ${configPath} not found — relying on env overrides`);
  }

  const config = loadConfig(raw, process.env);
  const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

  // Graceful SIGINT (§7): stop after the in-flight cycle work.
  let running = true;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      if (running) log(`received ${sig} — shutting down after current step`);
      running = false;
    });
  }

  await runLoop(config, { log, shouldContinue: () => running });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });
