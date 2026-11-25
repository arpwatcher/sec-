// Builds what GitHub Pages serves: node tools/build-site.mjs <outDir> <version>
// Copies only the files the page needs and stamps every relative import with ?v=<version>,
// so a browser never mixes files from two deploys.
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const [out = "site", version = "dev"] = process.argv.slice(2);
const root = new URL("..", import.meta.url).pathname;
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "exams"), { recursive: true });

const stamp = (src) => src
  .replace(/(from\s+["'])(\.{1,2}\/[^"'?]+\.js)(["'])/g, `$1$2?v=${version}$3`)
  .replace(/(import\(\s*["'])(\.{1,2}\/[^"'?]+\.js)(["']\s*\))/g, `$1$2?v=${version}$3`);

const js = ["app.js", ...readdirSync(join(root, "exams")).filter((f) => f.endsWith(".js")).map((f) => `exams/${f}`)];
for (const f of js) writeFileSync(join(out, f), stamp(readFileSync(join(root, f), "utf8")));

for (const f of ["style.css", "favicon.svg", "og.png"]) {
  if (existsSync(join(root, f))) { mkdirSync(dirname(join(out, f)), { recursive: true }); copyFileSync(join(root, f), join(out, f)); }
}

let html = readFileSync(join(root, "index.html"), "utf8");
html = html
  .replace('<meta name="build" content="dev">', `<meta name="build" content="${version}">`)
  .replace('href="style.css"', `href="style.css?v=${version}"`)
  .replace('src="app.js"', `src="app.js?v=${version}"`);
writeFileSync(join(out, "index.html"), html);
writeFileSync(join(out, "version.json"), JSON.stringify({ version }) + "\n");
writeFileSync(join(out, ".nojekyll"), "");
console.log(`built ${out} (${version}): ${js.length} scripts`);
