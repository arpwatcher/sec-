// Browser smoke test: node tools/smoke.mjs   (SITE_ROOT=site to test a built site, SHOTS=dir for screenshots)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.env.SITE_ROOT || new URL("..", import.meta.url).pathname;
const SHOTS = process.env.SHOTS || "";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  try {
    const file = path === "/" || path === "\\" ? "index.html" : path;
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

let fails = 0, oks = 0;
const ok = (cond, msg) => { if (cond) { oks++; } else { fails++; console.log(`FAIL: ${msg}`); } };
const errors = [];
const browser = await chromium.launch();

async function newPage(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  return { ctx, page };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  /* ---- desktop run ---- */
  const { ctx, page } = await newPage({ width: 1440, height: 900 });
  await page.goto(base);
  await page.waitForSelector(".exam-card");
  ok((await page.title()).includes("Security+"), "home title");
  ok(await page.locator(".exam-card").count() >= 1, "exam cards on home");
  await shot(page, "home-1440");
  await page.click("text=Start the newest mock");
  await page.waitForSelector("#begin");
  await shot(page, "intro-1440");
  await page.click("#begin");
  await page.waitForSelector(".xbar");
  ok(/^\d:\d\d:\d\d$/.test(await page.textContent("#x-time")), "timer format");
  ok((await page.textContent("#x-count")).trim() === "Item 1 of 90", "item counter");
  ok(await page.locator(".pbq-table select").count() > 0, "first item is a table PBQ");
  ok(await page.isDisabled("#prev"), "previous disabled on item 1");
  for (const s of await page.locator(".pbq-table select").all()) await s.selectOption({ index: 1 });
  await shot(page, "pbq-table-1440");
  await page.click("#next");

  // match PBQ: tap a token, then a slot
  await page.waitForSelector(".bank .token");
  const firstTok = (await page.textContent(".bank .token")).trim();
  await page.click(".bank .token");
  await page.click(".slot[data-s='0']");
  ok((await page.textContent(".slot[data-s='0']")).trim() === firstTok, "token placed in slot");
  await page.click("#flag");
  ok((await page.getAttribute("#flag", "aria-pressed")) === "true", "flag toggles on");
  await shot(page, "pbq-match-1440");
  await page.click("#next");

  // order PBQ
  await page.waitForSelector(".order-row");
  const before = await page.textContent(".order-row[data-pos='0'] .order-t");
  await page.click(".order-row[data-pos='0'] [data-down]");
  ok((await page.textContent(".order-row[data-pos='1'] .order-t")) === before, "order step moved down");
  await page.click("#next");
  await page.click("#next");
  await page.click("#next");

  // first multiple-choice item
  await page.waitForSelector(".opt");
  ok((await page.textContent("#x-count")).trim() === "Item 6 of 90", "item 6 after the five PBQs");
  await page.click(".opt >> nth=0 >> label");
  ok(await page.locator(".opt.sel").count() === 1, "option selected");
  await page.click(".opt >> nth=1 >> .strike");
  ok(await page.locator(".opt.struck").count() === 1, "strike button");
  await page.click(".opt >> nth=2", { button: "right" });
  ok(await page.locator(".opt.struck").count() === 2, "right-click strikes");
  await shot(page, "mcq-1440");

  // find a multi-response item and test the limit
  let guard = 0;
  while (!(await page.textContent("#x-hint")).startsWith("Select") && guard++ < 90) await page.click("#next");
  ok(guard < 90, "found a multiple-response item");
  const opts = page.locator(".opt label");
  await opts.nth(0).click(); await opts.nth(1).click(); await opts.nth(2).click();
  ok(await page.locator(".opt.sel").count() === 2, "multi limited to choose count");
  ok(await page.isVisible("#too-many"), "too-many note shown");

  // review screen
  await page.keyboard.press("Alt+r");
  await page.waitForSelector(".review");
  ok(await page.locator(".rv-cell").count() === 90, "review lists 90 items");
  await page.click("[data-f='flagged']");
  ok(await page.locator(".rv-cell").count() === 1, "flagged filter shows 1");
  await shot(page, "review-1440");
  await page.click(".rv-cell");
  ok((await page.textContent("#x-count")).trim() === "Item 2 of 90", "jump back to the flagged item");
  ok((await page.getAttribute("#flag", "aria-pressed")) === "true", "flag still on");

  // resume after reload
  await page.reload();
  await page.waitForSelector(".xbar");
  ok((await page.textContent("#x-count")).trim() === "Item 2 of 90", "resume on the same item after reload");
  ok((await page.textContent(".slot[data-s='0']")).trim() === firstTok, "answer kept after reload");

  // end the exam
  await page.click("#review");
  await page.click("#review");
  await page.waitForSelector("#dlg[open]");
  ok((await page.textContent("#dlg-body")).includes("incomplete"), "end dialog warns about incomplete items");
  await page.click("#dlg-actions .primary");
  await page.waitForSelector(".score-card");
  const score = Number(await page.textContent(".sc-num"));
  ok(score >= 100 && score < 750, `low score for a mostly blank exam (${score})`);
  ok(await page.locator(".rv-card").count() === 90, "report lists 90 items");
  await page.click("#rf [data-f='pbq']");
  ok(await page.locator(".rv-card").count() === 5, "report filter: 5 PBQs");
  ok(await page.locator(".missed li").count() > 10, "objectives to review listed");
  await shot(page, "report-1440");

  // a perfect attempt scores 900
  await page.evaluate(async () => {
    const exam = (await import("./exams/mock-01.js")).default;
    const answers = {};
    for (const it of exam.items) {
      if (it.type === "single" || it.type === "multi") answers[it.id] = it.answer;
      else if (it.kind === "match") answers[it.id] = it.slots.map((s) => s.answer);
      else if (it.kind === "order") answers[it.id] = it.steps.map((_, i) => i);
      else if (it.kind === "table") {
        const v = {};
        it.rows.forEach((row, r) => row.forEach((c, k) => { if (c && typeof c === "object") v[`${r}:${k}`] = c.answer; }));
        answers[it.id] = v;
      }
    }
    const order = exam.items.map((i) => i.id);
    const perm = {};
    for (const it of exam.items) {
      if (it.options) perm[it.id] = it.options.map((_, i) => i);
      if (it.steps) perm[it.id] = it.steps.map((_, i) => i);
    }
    localStorage.setItem("secplus.attempt.v1.mock-01", JSON.stringify({ examId: "mock-01", seed: 1, order, perm, answers, flags: {}, struck: {}, cur: 89, remaining: 3600000, started: new Date().toISOString(), visited: {} }));
  });
  await page.goto(`${base}#/exam/mock-01`);
  await page.waitForSelector(".xbar");
  await page.click("#review");
  ok((await page.textContent(".rv-sum")).includes("0 incomplete"), "perfect attempt has nothing incomplete");
  await page.click("#review");
  await page.click("#dlg-actions .primary");
  await page.waitForSelector(".score-card");
  ok((await page.textContent(".sc-num")).trim() === "900", "perfect attempt scores 900");
  ok((await page.textContent(".sc-verdict")).trim() === "Passed", "perfect attempt passes");
  await page.goto(base);
  await page.waitForSelector(".exam-card");
  ok((await page.textContent(".exam-card")).includes("Best 900"), "home shows best score");
  await ctx.close();

  /* ---- 1920 and phone layouts ---- */
  for (const vp of [{ width: 1920, height: 945, n: "1920" }, { width: 390, height: 844, n: "390" }]) {
    const { ctx: c2, page: p2 } = await newPage({ width: vp.width, height: vp.height }, vp.n === "390" ? { isMobile: true, hasTouch: true } : {});
    await p2.goto(base);
    await p2.waitForSelector(".exam-card");
    ok(await noHScroll(p2), `${vp.n}: home has no horizontal scroll`);
    await shot(p2, `home-${vp.n}`);
    await p2.goto(`${base}#/exam/mock-01`);
    await p2.click("#begin");
    await p2.waitForSelector(".pbq-table");
    ok(await noHScroll(p2), `${vp.n}: table PBQ page has no horizontal scroll`);
    await shot(p2, `pbq-table-${vp.n}`);
    await p2.click("#next");
    await p2.waitForSelector(".bank .token");
    await p2.tap?.(".bank .token").catch(() => {});
    if (vp.n === "390") {
      await p2.tap(".slot[data-s='0']");
      ok((await p2.textContent(".slot[data-s='0']")).includes("Drop") === false, "phone: tap token then slot places it");
    }
    ok(await noHScroll(p2), `${vp.n}: match PBQ has no horizontal scroll`);
    await shot(p2, `pbq-match-${vp.n}`);
    for (let i = 0; i < 4; i++) await p2.click("#next");
    await p2.waitForSelector(".opt");
    ok(await noHScroll(p2), `${vp.n}: multiple-choice item has no horizontal scroll`);
    ok(await p2.isVisible("#next"), `${vp.n}: Next visible`);
    await shot(p2, `mcq-${vp.n}`);
    await p2.click("#review");
    ok(await noHScroll(p2), `${vp.n}: review screen has no horizontal scroll`);
    await shot(p2, `review-${vp.n}`);
    await c2.close();
  }
} catch (e) {
  fails++;
  console.log(`FAIL: exception ${e.stack || e}`);
} finally {
  await browser.close();
  server.close();
}
for (const e of errors) { fails++; console.log(`FAIL: ${e}`); }
console.log(`smoke-ok=${oks} fail=${fails}`);
process.exit(fails ? 1 : 0);
