/**
 * The worker's own URL helpers, loaded into a plain node script.
 *
 * Both the survey and the page it renders have to answer "is this URI content
 * addressed, and what serves it here?". Answering that twice, in two
 * implementations, is how a dataset and a production route quietly stop
 * agreeing, so both tools bundle the real `functions/_utils/url.ts` and use it.
 */
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `gatewayPath` from the worker itself. */
export async function loadGatewayPath() {
  const dir = mkdtempSync(join(tmpdir(), "embed-art-url-"));
  const outfile = join(dir, "url.mjs");
  await build({
    entryPoints: [join(ROOT, "functions/_utils/url.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "warning",
  });
  return (await import(pathToFileURL(outfile).href)).gatewayPath;
}
