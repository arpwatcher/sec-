// Lists every item of every mock by objective, so a new mock does not repeat a scenario:
// node tools/topics.mjs [objective]   e.g. node tools/topics.mjs 2.5
import { EXAMS } from "../exams/index.js";

const only = process.argv[2];
const strip = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const rows = [];
for (const meta of EXAMS) {
  const exam = (await meta.load()).default;
  for (const it of exam.items) {
    if (only && it.obj !== only) continue;
    const kind = it.type === "pbq" ? `pbq:${it.kind}` : it.type;
    rows.push({ obj: it.obj, line: `${it.obj.padEnd(4)} ${it.id.padEnd(9)} ${kind.padEnd(10)} ${strip(it.stem).slice(0, 150)}` });
  }
}
rows.sort((a, b) => a.obj.localeCompare(b.obj, undefined, { numeric: true }));
for (const r of rows) console.log(r.line);
console.log(`${rows.length} items`);
