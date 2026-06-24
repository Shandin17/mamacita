import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadProfile } from "./config.ts";
import { buildAutofillSnippet, buildBookmarklet } from "./autofill.ts";

// PRD §3/FR3 (issue #5): generate the one-time autofill helper from the
// CustomerProfile in config.json. Prints a readable `.js` snippet and a
// one-line `javascript:` bookmarklet; optionally writes them to a file.
//
//   npm run autofill                 # print to stdout
//   npm run autofill -- autofill.js  # also write the snippet to a file
function main(): void {
  const configPath = resolve(process.env.CONFIG_PATH ?? "config.json");

  let raw: unknown = {};
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    console.warn(`[config] ${configPath} not found — relying on env overrides`);
  }

  const profile = loadProfile(raw);
  const snippet = buildAutofillSnippet(profile);
  const bookmarklet = buildBookmarklet(profile);

  const outPath = process.argv[2];
  if (outPath) {
    writeFileSync(resolve(outPath), snippet, "utf8");
    console.log(`[autofill] snippet written to ${outPath}`);
  }

  console.log("\n===== readable .js snippet =====\n");
  console.log(snippet);
  console.log("\n===== one-line javascript: bookmarklet =====\n");
  console.log(bookmarklet);
  console.log(
    "\nInstall: create a new bookmark, paste the line above as its URL. " +
      "See README for full steps.",
  );
}

main();
