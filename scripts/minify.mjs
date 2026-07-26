/**
 * Production build:
 * - JS → /js/v/*.js one-line minified bundles (hard to read)
 * - CSS → /css/v/*.css one-line minified
 * - HTML → root pages collapsed to a single line for View Source
 * Mouse / right-click are NEVER blocked.
 */
import * as esbuild from "esbuild";
import { mkdir, readFile, writeFile, readdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsDir = path.join(root, "js");
const cssDir = path.join(root, "css");
const outJs = path.join(root, "js", "v");
const outCss = path.join(root, "css", "v");

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

/** Collapse HTML to one line; strip comments; point assets to /js/v and /css/v */
function minifyHtml(html) {
  let h = html
    // drop protect scripts entirely
    .replace(/<script[^>]*protect\.js[^>]*><\/script>\s*/gi, "")
    // production asset paths
    .replaceAll('href="/css/main.css"', 'href="/css/v/main.css"')
    .replaceAll('href="/css/app.css"', 'href="/css/v/app.css"')
    .replaceAll('src="/js/landing.js"', 'src="/js/v/landing.js"')
    .replaceAll('src="/js/login.js"', 'src="/js/v/login.js"')
    .replaceAll('src="/js/signup.js"', 'src="/js/v/signup.js"')
    .replaceAll('src="/js/dashboard.js"', 'src="/js/v/dashboard.js"')
    .replaceAll('src="/js/sessions-page.js"', 'src="/js/v/sessions-page.js"')
    .replaceAll('src="/js/v/protect.js"', "")
    .replace(/src="\/js\/v\/protect\.js"/g, "")
    // HTML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // collapse whitespace between tags
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Force single physical line (View Source = one wall of text)
  h = h.replace(/\r?\n/g, "");

  // Decoy one-liner junk (looks like packed payload, does nothing)
  const decoy =
    '<script type="text/javascript">/*!TS*/(function(_0x' +
    Math.random().toString(16).slice(2, 8) +
    "){var _0xa='" +
    Buffer.from("Telegram Session Store decoy " + Date.now())
      .toString("base64")
      .replace(/=+$/, "") +
    "';try{atob(_0xa)}catch(_0xe){}})();</script>";

  // Inject decoy before </body>
  if (h.includes("</body>")) {
    h = h.replace("</body>", decoy + "</body>");
  } else {
    h += decoy;
  }

  return h;
}

await mkdir(outJs, { recursive: true });
await mkdir(outCss, { recursive: true });

// --- JS one-liners ---
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
  console.log("js ", file, "→ one-line", code.length, "chars");
}

// remove protect from prod bundle dir if present
try {
  await writeFile(
    path.join(outJs, "protect.js"),
    "/*empty*/",
    "utf8"
  );
} catch {
  /* ignore */
}

// --- CSS one-liners ---
// app.css @imports main — inline main into app for single file where needed
const mainCss = await readFile(path.join(cssDir, "main.css"), "utf8");
const appCssRaw = await readFile(path.join(cssDir, "app.css"), "utf8");
const appCss = appCssRaw.replace(
  /@import\s+url\(["']?\.\/main\.css["']?\);?/i,
  mainCss
);

await writeFile(path.join(outCss, "main.css"), minifyCss(mainCss), "utf8");
await writeFile(path.join(outCss, "app.css"), minifyCss(appCss), "utf8");
console.log("css → /css/v/*.css one-line");

// --- HTML one-liners (production pages) ---
// Keep readable templates under /src/pages if we want later; for now minify live HTML
for (const page of htmlPages) {
  const p = path.join(root, page);
  let src = await readFile(p, "utf8");

  // If already minified previously, recover is hard — always build from "pretty" if available
  const prettyPath = path.join(root, "src", "pages", page);
  try {
    src = await readFile(prettyPath, "utf8");
  } catch {
    // use current file; if it's already one line, still re-process paths
  }

  const out = minifyHtml(src);
  await writeFile(p, out, "utf8");
  console.log("html", page, "→ 1 line,", out.length, "chars");
}

console.log("Done. Right-click/mouse normal. View Source = single-line wall.");
