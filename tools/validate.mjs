// Checks every mock exam listed in exams/index.js. Exit code 1 on any error.
import { EXAMS } from "../exams/index.js";
import { BLUEPRINT, OBJECTIVES } from "../exams/objectives.js";

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const strip = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const norm = (h) => strip(h).toLowerCase().replace(/[^a-z0-9 ]/g, "");

const seenIds = new Set();
const seenStems = new Map();
const seenDates = new Set();
let longestRight = 0, singles = 0;

function tagsBalanced(html, where) {
  for (const t of ["p", "ul", "ol", "li", "b", "i", "code", "table", "tr", "td", "th"]) {
    const open = (html.match(new RegExp(`<${t}(\\s[^>]*)?>`, "g")) || []).length;
    const close = (html.match(new RegExp(`</${t}>`, "g")) || []).length;
    if (open !== close) err(`${where}: <${t}> opened ${open}, closed ${close}`);
  }
}

for (const [n, meta] of EXAMS.entries()) {
  const want = `mock-${String(n + 1).padStart(2, "0")}`;
  if (meta.id !== want) err(`exams/index.js entry ${n}: id ${meta.id}, expected ${want}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) err(`${meta.id}: bad date ${meta.date}`);
  if (seenDates.has(meta.date)) warn(`${meta.id}: a second mock on ${meta.date}`);
  seenDates.add(meta.date);
  const exam = (await meta.load()).default;
  const tag = `m${String(n + 1).padStart(2, "0")}-`;
  if (exam.minutes !== 90) err(`${meta.id}: minutes ${exam.minutes}, expected 90`);
  if (exam.items.length !== 90) err(`${meta.id}: ${exam.items.length} items, expected 90`);
  const dom = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let pbqs = 0, multis = 0;
  for (const it of exam.items) {
    const w = `${meta.id}/${it.id}`;
    if (!it.id?.startsWith(tag)) err(`${w}: id must start with ${tag}`);
    if (seenIds.has(it.id)) err(`${w}: duplicate id`);
    seenIds.add(it.id);
    if (!OBJECTIVES[it.obj]) err(`${w}: unknown objective ${it.obj}`);
    dom[Number(String(it.obj).split(".")[0])]++;
    if (!it.stem || strip(it.stem).length < 30) err(`${w}: stem missing or too short`);
    if (!it.explain || strip(it.explain).length < 120) err(`${w}: explanation missing or too short`);
    tagsBalanced(it.stem, `${w} stem`);
    tagsBalanced(it.explain, `${w} explain`);
    const key = norm(it.stem).slice(0, 160);
    if (seenStems.has(key)) err(`${w}: same stem as ${seenStems.get(key)}`);
    seenStems.set(key, w);
    const text = `${strip(it.stem)} ${(it.options || []).map(strip).join(" ")}`;
    if (/\b(all|none|both) of the (above|options)\b/i.test(text)) err(`${w}: options are shuffled, avoid "all/none of the above"`);
    if (/\boption [A-F]\b|\banswer [A-F]\b|\b[A-F] and [A-F]\b/.test(strip(it.explain) + text)) err(`${w}: refers to an option by letter, but options are shuffled`);
    if (it.type === "single" || it.type === "multi") {
      if (!Array.isArray(it.options) || it.options.length < 4) err(`${w}: needs at least 4 options`);
      it.options.forEach((o, k) => tagsBalanced(o, `${w} option ${k}`));
      const uniq = new Set(it.options.map(norm));
      if (uniq.size !== it.options.length) err(`${w}: duplicate options`);
    }
    if (it.type === "single") {
      singles++;
      if (!Number.isInteger(it.answer) || it.answer < 0 || it.answer >= it.options.length) err(`${w}: bad answer index`);
      else {
        const lens = it.options.map((o) => strip(o).length);
        const others = lens.filter((_, k) => k !== it.answer);
        const next = Math.max(...others);
        // a give-away: the right option is clearly the longest (25% and 15 characters over the next one)
        if (lens[it.answer] > next * 1.25 && lens[it.answer] - next >= 15) { longestRight++; warn(`${w}: the correct option is clearly the longest (${lens.join("/")})`); }
      }
    } else if (it.type === "multi") {
      multis++;
      if (!Number.isInteger(it.choose) || it.choose < 2) err(`${w}: multi needs choose >= 2`);
      if (!Array.isArray(it.answer) || it.answer.length !== it.choose) err(`${w}: answer count must equal choose`);
      if (new Set(it.answer).size !== it.answer.length) err(`${w}: repeated answer index`);
      if (it.answer.some((a) => !Number.isInteger(a) || a < 0 || a >= it.options.length)) err(`${w}: answer index out of range`);
      if (it.options.length < it.choose + 2) err(`${w}: too few options for choose ${it.choose}`);
      const words = ["", "", "TWO", "THREE", "FOUR"][it.choose];
      if (words && !strip(it.stem).includes(words)) err(`${w}: stem should say ${words}`);
    } else if (it.type === "pbq") {
      pbqs++;
      if (it.kind === "match") {
        if (!it.pool?.length || !it.slots?.length) err(`${w}: match needs pool and slots`);
        if (it.slots.some((s) => !Number.isInteger(s.answer) || s.answer < 0 || s.answer >= it.pool.length)) err(`${w}: slot answer out of range`);
        if (!it.reuse && new Set(it.slots.map((s) => s.answer)).size !== it.slots.length) err(`${w}: tokens are single-use but answers repeat`);
        if (it.pool.length < it.slots.length) err(`${w}: fewer tokens than slots`);
        it.slots.forEach((s, k) => tagsBalanced(s.label, `${w} slot ${k}`));
      } else if (it.kind === "order") {
        if (!it.steps || it.steps.length < 4) err(`${w}: order needs at least 4 steps`);
        if (new Set(it.steps).size !== it.steps.length) err(`${w}: duplicate steps`);
      } else if (it.kind === "table") {
        if (!it.columns?.length || !it.rows?.length) err(`${w}: table needs columns and rows`);
        let cells = 0;
        it.rows.forEach((row, r) => {
          if (row.length !== it.columns.length) err(`${w}: row ${r + 1} has ${row.length} cells for ${it.columns.length} columns`);
          row.forEach((c, k) => {
            if (c && typeof c === "object") {
              cells++;
              if (!c.opts?.includes(c.answer)) err(`${w}: row ${r + 1} col ${k + 1} answer not among options`);
              if (new Set(c.opts).size !== c.opts.length) err(`${w}: row ${r + 1} col ${k + 1} duplicate options`);
            }
          });
        });
        if (cells < 4) err(`${w}: table needs at least 4 cells to fill`);
      } else err(`${w}: unknown pbq kind ${it.kind}`);
    } else err(`${w}: unknown type ${it.type}`);
  }
  for (const d of Object.keys(BLUEPRINT)) {
    if (dom[d] !== BLUEPRINT[d]) err(`${meta.id}: domain ${d} has ${dom[d]} items, blueprint says ${BLUEPRINT[d]}`);
  }
  if (pbqs < 3 || pbqs > 6) err(`${meta.id}: ${pbqs} PBQs, expected 3 to 6`);
  if (multis < 5) warn(`${meta.id}: only ${multis} multiple-response items`);
  const objs = new Set(exam.items.map((i) => i.obj));
  const missing = Object.keys(OBJECTIVES).filter((o) => !objs.has(o));
  if (missing.length > 3) warn(`${meta.id}: objectives not covered: ${missing.join(", ")}`);
  console.log(`${meta.id}: ${exam.items.length} items, domains ${Object.values(dom).join("/")}, ${pbqs} PBQs, ${multis} multi, objectives ${objs.size}/${Object.keys(OBJECTIVES).length}${missing.length ? ` (missing ${missing.join(" ")})` : ""}`);
}
if (longestRight) err(`${longestRight} item(s) where the correct option is clearly the longest: balance the options so length gives nothing away`);
for (const w of warns) console.log(`warning: ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
console.log(errors.length ? `validate: ${errors.length} error(s)` : "validate: ok");
process.exit(errors.length ? 1 : 0);
