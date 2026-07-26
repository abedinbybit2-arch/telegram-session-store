/**
 * Production build — JavaScript-hidden pages
 *
 * View Source shows ONLY one line:
 *   a tiny HTML shell + one packed JS that atob()s the real page and document.write()s it.
 *
 * Mouse / right-click stay fully normal (no blocking).
 */
import * as esbuild from "esbuild";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsDir = path.join(root, "js");
const cssDir = path.join(root, "css");
const outJs = path.join(root, "js", "v");
const outCss = path.join(root, "css", "v");
const pagesDir = path.join(root, "src", "pages");

const jsEntries = [
  "landing.js",
  "login.js",
  "signup.js",
  "dashboard.js",
  "sessions-page.js",
];

const htmlPages = [
  "index.html",
  "login.html",
  "signup.html",
  "dashboard.html",
  "sessions.html",
];

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>~+])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

/** Compact real HTML that JS will inject (still one string, not multi-line for smaller payload) */
function compactHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .replace(/\r?\n/g, "")
    .trim();
}

/**
 * Build a 1-line shell. View Source = only this.
 * Real UI is base64 inside JS and written at runtime.
 */
function buildJsShell(realHtml, title) {
  const b64 = Buffer.from(realHtml, "utf8").toString("base64");

  // Pack loader: decode base64 UTF-8 safely, then document.write full page
  // Entire shell is forced to a single physical line
  const loader =
    "(function(){try{var _b='" +
    b64 +
    "',_s=atob(_b),_u=new Uint8Array(_s.length);for(var i=0;i<_s.length;i++)_u[i]=_s.charCodeAt(i);var _h=new TextDecoder('utf-8').decode(_u);document.open();document.write(_h);document.close()}catch(e){document.body.textContent='Load error'}}())";

  const shell =
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/><title>" +
    title.replace(/</g, "") +
    "</title></head><body><script>" +
    loader +
    "</script><noscript>Enable JavaScript</noscript></body></html>";

  return shell.replace(/\r?\n/g, "");
}

function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : "Telegram Session Store";
}

await mkdir(outJs, { recursive: true });
await mkdir(outCss, { recursive: true });

// --- JS app bundles (one-line minified) ---
for (const file of jsEntries) {
  const infile = path.join(jsDir, file);
  const outfile = path.join(outJs, file);
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
    logLevel: "silent",
  });
  let code = await readFile(outfile, "utf8");
  code = code.replace(/\r?\n+/g, "");
  await writeFile(outfile, code, "utf8");
  console.log("js ", file, "→", code.length, "chars (1 line)");
}

// --- CSS one-liners ---
const mainCss = await readFile(path.join(cssDir, "main.css"), "utf8");
const appCssRaw = await readFile(path.join(cssDir, "app.css"), "utf8");
const appCss = appCssRaw.replace(
  /@import\s+url\(["']?\.\/main\.css["']?\);?/i,
  mainCss
);
await writeFile(path.join(outCss, "main.css"), minifyCss(mainCss), "utf8");
await writeFile(path.join(outCss, "app.css"), minifyCss(appCss), "utf8");
console.log("css → /css/v one-line");

// --- HTML: JavaScript-hidden shells (View Source = 1 line only) ---
for (const page of htmlPages) {
  const srcPath = path.join(pagesDir, page);
  const real = await readFile(srcPath, "utf8");
  const compact = compactHtml(real);
  const title = extractTitle(real);
  const shell = buildJsShell(compact, title);
  await writeFile(path.join(root, page), shell, "utf8");
  const lines = shell.split(/\r?\n/).length;
  console.log(
    "html",
    page,
    "→ shell lines:",
    lines,
    "chars:",
    shell.length,
    "(JS-hidden page)"
  );
}

console.log(
  "\nDone. View Source = 1 line JS shell. Real HTML only after JS runs. Mouse normal."
);
