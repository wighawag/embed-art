#!/usr/bin/env node
/**
 * Test runner. The worker sources are TypeScript with extensionless imports,
 * which Node cannot load directly, so each test file is bundled with esbuild
 * (already a dependency of the build) and then executed.
 *
 *   pnpm test                     offline checks only
 *   TEST_LIVE=1 pnpm test         also hit a real Ethereum node
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const files = ["unit.test.ts"];
if (process.env.TEST_LIVE) files.push("live.test.ts");
else console.log("\n  (skipping live tests; set TEST_LIVE=1 to include them)");

const out = mkdtempSync(join(tmpdir(), "embed-art-test-"));
let failed = false;

try {
  for (const file of files) {
    console.log(`\n${file}`);
    const bundle = join(out, basename(file, ".ts") + ".mjs");
    await build({
      entryPoints: [join(here, file)],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "warning",
    });
    try {
      await import(pathToFileURL(bundle).href);
    } catch (err) {
      // assert.report() exits non-zero on failure; anything else is a crash
      if (typeof err?.code === "number") process.exitCode = err.code;
      else {
        console.error(err);
        failed = true;
      }
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failed) process.exit(1);
