import * as esbuild from "esbuild";
import { writeFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "scripts", "tg-client-entry.js");
const outfile = path.join(root, "js", "v", "tg-client.js");

writeFileSync(
  entry,
  `
export { TelegramClient } from "telegram";
export { StringSession } from "telegram/sessions";
`
);

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile,
  minify: true,
  legalComments: "none",
  logLevel: "info",
  mainFields: ["browser", "module", "main"],
  define: {
    "process.env.NODE_DEBUG": "false",
    global: "globalThis",
    "process.env": "{}",
  },
  banner: {
    js: "const process={env:{}};",
  },
});

console.log("bundled", outfile, "bytes", statSync(outfile).size);
