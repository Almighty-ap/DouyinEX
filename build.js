import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const header = readFileSync("src/header.txt", "utf8").replace("__VERSION__", pkg.version);

mkdirSync("dist", { recursive: true });

const result = await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "iife",
  target: "es2020",
  write: false,
  loader: { ".css": "text" },
  legalComments: "none",
});

writeFileSync("dist/douyinex.user.js", header + "\n" + result.outputFiles[0].text);
console.log("built dist/douyinex.user.js v" + pkg.version);
