/**
 * Production minify — bundles page entry modules into hard-to-read one-liners under js/v/
 */
import * as esbuild from "esbuild";
import { mkdir, readFile, writeFile, readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsDir = path.join(root, "js");
const outDir = path.join(root, "js", "v");

const entries = [
  "landing.js",
  "login.js",
  "signup.js",
  "dashboard.js",
  "sessions-page.js",
  "protect.js",
];

await mkdir(outDir, { recursive: true });

for (const file of entries) {
  const infile = path.join(jsDir, file);
  const outfile = path.join(outDir, file);
  await esbuild.build({
    entryPoints: [infile],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["esnext"],
    minify: true,
    legalComments: "none",
    sourcemap: false,
    external: ["https://www.gstatic.com/*"],
    logLevel: "info",
  });

  let code = await readFile(outfile, "utf8");
  code = code.replace(/\n+/g, "");
  await writeFile(outfile, code, "utf8");
  console.log("minified", file);
}

// Rewrite HTML script tags to load /js/v/* production bundles
const htmlFiles = (await readdir(root)).filter((f) => f.endsWith(".html"));
for (const html of htmlFiles) {
  const p = path.join(root, html);
  let src = await readFile(p, "utf8");
  const next = src
    .replaceAll('src="/js/landing.js"', 'src="/js/v/landing.js"')
    .replaceAll('src="/js/login.js"', 'src="/js/v/login.js"')
    .replaceAll('src="/js/signup.js"', 'src="/js/v/signup.js"')
    .replaceAll('src="/js/dashboard.js"', 'src="/js/v/dashboard.js"')
    .replaceAll('src="/js/sessions-page.js"', 'src="/js/v/sessions-page.js"')
    .replaceAll('src="/js/protect.js"', 'src="/js/v/protect.js"');
  if (next !== src) {
    await writeFile(p, next, "utf8");
    console.log("rewrote", html);
  }
}

console.log("Done — production pages load minified /js/v/* bundles.");
