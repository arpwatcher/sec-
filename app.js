import { EXAMS } from "./exams/index.js";
import { DOMAINS, OBJECTIVES } from "./exams/objectives.js";

const PASS = 750;
const PBQ_WEIGHT = 3;
const KEY_ATTEMPT = (id) => `secplus.attempt.v1.${id}`;
const KEY_RESULTS = "secplus.results.v1";

const app = document.getElementById("app");
const loaded = new Map();

/* ---------- storage ---------- */
const store = {
  get(k, d = null) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const results = () => store.get(KEY_RESULTS, {});

/* ---------- helpers ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const LETTERS = "ABCDEFGHIJ";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const range = (n) => Array.from({ length: n }, (_, i) => i);
const domainOf = (item) => Number(String(item.obj).split(".")[0]);
const isPbq = (item) => item.type === "pbq";

function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
function mmss(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function mins(ms) {
  const m = Math.round(ms / 60000);
  return `${m} min`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

async function loadExam(id) {
  if (loaded.has(id)) return loaded.get(id);
  const meta = EXAMS.find((e) => e.id === id);
  if (!meta) return null;
  const mod = await meta.load();
  const exam = { ...mod.default, id: meta.id, title: meta.title, date: meta.date };
  exam.byId = new Map(exam.items.map((it) => [it.id, it]));
  loaded.set(id, exam);
  return exam;
}

/* ---------- dialog ---------- */
function ask(title, bodyHtml, buttons) {
  const dlg = document.getElementById("dlg");
  $("#dlg-title").textContent = title;
  $("#dlg-body").innerHTML = bodyHtml;
  const acts = $("#dlg-actions");
  acts.innerHTML = buttons.map((b, i) => `<button value="${i}" class="btn ${b.primary ? "primary" : ""}">${esc(b.label)}</button>`).join("");
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue === "" ? null : buttons[Number(dlg.returnValue)]?.value ?? null);
    dlg.returnValue = "";
    dlg.showModal();
    const primary = acts.querySelector(".primary") || acts.querySelector("button");
    primary?.focus();
  });
}

/* ---------- attempts ---------- */
function newAttempt(exam) {
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const rand = rng(seed);
  const pbqs = exam.items.filter(isPbq).map((it) => it.id);
  const mcqs = shuffle(exam.items.filter((it) => !isPbq(it)).map((it) => it.id), rand);
  const perm = {};
  for (const it of exam.items) {
    if (it.type === "single" || it.type === "multi") {
      perm[it.id] = it.fixedOrder ? range(it.options.length) : shuffle(range(it.options.length), rand);
    } else if (it.kind === "order") {
      let p = shuffle(range(it.steps.length), rand);
      if (p.every((v, i) => v === i)) p = p.slice(1).concat(p[0]);
      perm[it.id] = p;
    }
  }
  return {
    examId: exam.id, seed, order: [...pbqs, ...mcqs], perm,
    answers: {}, flags: {}, struck: {}, cur: 0,
    remaining: exam.minutes * 60000, started: new Date().toISOString(), visited: {}, spent: {},
  };
}
const saveAttempt = (a) => store.set(KEY_ATTEMPT(a.examId), a);

function answered(item, v) {
  if (v === undefined || v === null) return false;
  if (item.type === "single") return typeof v === "number";
  if (item.type === "multi") return Array.isArray(v) && v.length === item.choose;
  if (item.kind === "match") return Array.isArray(v) && v.length === item.slots.length && v.every((x) => x !== null && x !== undefined);
  if (item.kind === "order") return Array.isArray(v);
  if (item.kind === "table") return cellsOf(item).every((c) => v[c.key] !== undefined && v[c.key] !== "");
  return false;
}

function cellsOf(item) {
  const out = [];
  item.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell && typeof cell === "object") out.push({ key: `${r}:${c}`, cell, r, c });
  }));
  return out;
}

/* ---------- grading ---------- */
function gradeItem(item, v) {
  if (item.type === "single") {
    const ok = v === item.answer;
    return { score: ok ? 1 : 0, max: 1, full: ok };
  }
  if (item.type === "multi") {
    const want = [...item.answer].sort().join(",");
    const ok = Array.isArray(v) && [...v].sort().join(",") === want;
    return { score: ok ? 1 : 0, max: 1, full: ok };
  }
  const w = item.weight || PBQ_WEIGHT;
  let parts = 0, good = 0;
  if (item.kind === "match") {
    parts = item.slots.length;
    item.slots.forEach((s, i) => { if (Array.isArray(v) && v[i] === s.answer) good++; });
  } else if (item.kind === "order") {
    parts = item.steps.length;
    if (Array.isArray(v)) v.forEach((stepIdx, pos) => { if (stepIdx === pos) good++; });
  } else if (item.kind === "table") {
    const cells = cellsOf(item);
    parts = cells.length;
    cells.forEach((c) => { if (v && v[c.key] === c.cell.answer) good++; });
  }
  const score = parts ? (w * good) / parts : 0;
  return { score, max: w, full: good === parts, good, parts };
}

function gradeAttempt(exam, attempt) {
  let earned = 0, total = 0, full = 0;
  const byDomain = {};
  const per = {};
  const missed = new Set();
  for (const id of attempt.order) {
    const item = exam.byId.get(id);
    const g = gradeItem(item, attempt.answers[id]);
    per[id] = g;
    earned += g.score; total += g.max;
    if (g.full) full++; else missed.add(item.obj);
    const d = domainOf(item);
    byDomain[d] ??= { earned: 0, total: 0, items: 0 };
    byDomain[d].earned += g.score; byDomain[d].total += g.max; byDomain[d].items++;
  }
  const scaled = Math.round(100 + (800 * earned) / total);
  return { earned, total, full, count: attempt.order.length, byDomain, per, missed: [...missed].sort(objCompare), scaled, pass: scaled >= PASS };
}
function objCompare(a, b) {
  const [a1, a2] = a.split(".").map(Number), [b1, b2] = b.split(".").map(Number);
  return a1 - b1 || a2 - b2;
}

/* ---------- router ---------- */
let stopTimer = null;
window.addEventListener("hashchange", route);

async function route() {
  if (stopTimer) { stopTimer(); stopTimer = null; }
  document.body.classList.remove("in-exam");
  const h = location.hash.replace(/^#\/?/, "").split("/");
  try {
    if (h[0] === "exam" && h[1]) return await examPage(h[1]);
    if (h[0] === "result" && h[1]) return await resultPage(h[1], Number(h[2] || 0));
    return homePage();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<main class="wrap"><p>Something went wrong loading this page.</p><p><a href="#/">Back to the exams</a></p></main>`;
  }
}

/* ---------- header / footer ---------- */
function siteHeader() {
  return `<header class="top"><div class="top-in">
    <a class="brand" href="#/"><img src="favicon.svg" alt="" width="26" height="26"><span>Security+ <b>SY0-801</b> Mock Exams</span></a>
  </div></header>`;
}
function siteFooter() {
  return `<footer class="foot"><div class="wrap">
    <p>Independent practice material. The questions are original and written against the published SY0-801 V8 exam objectives; they are not taken from any CompTIA exam. CompTIA and Security+ are trademarks of CompTIA, Inc. This site is not affiliated with or endorsed by CompTIA.</p>
    <p>Your answers and scores are kept only in this browser.</p>
  </div></footer>`;
}

/* ---------- home ---------- */
function homePage() {
  document.title = "Security+ SY0-801 Mock Exams";
  const res = results();
  const cards = EXAMS.slice().reverse().map((e, i) => {
    const att = store.get(KEY_ATTEMPT(e.id));
    const list = res[e.id] || [];
    const best = list.reduce((m, r) => Math.max(m, r.scaled), 0);
    const last = list[list.length - 1];
    let status = `<span class="muted">Not taken yet</span>`;
    let action = `<a class="btn primary" href="#/exam/${e.id}">Start exam</a>`;
    if (att) {
      status = `<span class="state progress">In progress, ${esc(clock(att.remaining))} left</span>`;
      action = `<a class="btn primary" href="#/exam/${e.id}">Resume exam</a>`;
    } else if (list.length) {
      status = `<span class="state ${best >= PASS ? "ok" : "bad"}">Best ${best}</span> <span class="muted">${list.length} attempt${list.length > 1 ? "s" : ""}</span>`;
      action = `<a class="btn" href="#/result/${e.id}/${list.length - 1}">Last score report</a> <a class="btn primary" href="#/exam/${e.id}">Take again</a>`;
    }
    return `<article class="exam-card ${i === 0 ? "newest" : ""}">
      <div class="ec-head"><h3>${esc(e.title)}</h3>${i === 0 ? `<span class="tag">Newest</span>` : ""}</div>
      <p class="ec-meta">${esc(fmtDate(e.date))} &middot; 90 items &middot; 90 minutes</p>
      <p class="ec-status">${status}${last && !att ? ` <span class="muted">&middot; last ${last.scaled}</span>` : ""}</p>${last && !att ? weakest(last) : ""}
      <div class="ec-actions">${action}</div>
    </article>`;
  }).join("");

  const weights = Object.entries(DOMAINS).map(([n, d]) =>
    `<tr><td>${n}.0</td><td>${esc(d.name)}</td><td class="num">${d.weight}%</td></tr>`).join("");

  app.innerHTML = `${siteHeader()}
  <main class="wrap home">
    <section class="hero">
      <h1>Security+ SY0-801 mock exams that are harder than the real one</h1>
      <p class="lead">Each mock is a full exam form: up to 90 items in 90 minutes, performance-based questions first, then multiple choice. Flag items, strike out options, move back and forth, and check everything on the review screen before you end, as on the test day.</p>
      <p class="lead">The bar is set above the exam on purpose. A score at or above 750 here means you are ready.</p>
      <div class="hero-actions"><a class="btn primary big" href="#/exam/${EXAMS[EXAMS.length - 1].id}">Start the newest mock</a></div>
    </section>
    <section>
      <h2 class="sec-title">Mock exams</h2>
      <p class="muted sec-sub">A new mock is added every day.</p>
      <div class="exam-grid">${cards}</div>
    </section>
    <section class="two">
      <div>
        <h2 class="sec-title">How it works</h2>
        <ul class="rules">
          <li><b>Timing.</b> 90 minutes for the whole form. The clock runs while the exam is open and stops when you leave the page; your attempt is saved and can be resumed. At zero the exam ends and is scored.</li>
          <li><b>Performance-based questions</b> come first. You can skip them and return later; your work is kept. They give partial credit.</li>
          <li><b>Multiple choice</b> has one answer, or exactly the number it asks for ("Choose two"). Those score all or nothing, as on the exam.</li>
          <li><b>Tools.</b> Flag for review, strike out an option (right-click it, or use the strike button), Previous and Next, and the review screen with all, incomplete and flagged items.</li>
          <li><b>Score report.</b> A scaled score from 100 to 900 with 750 to pass, the result per domain, the objectives to review, and every item with its explanation.</li>
        </ul>
        <p class="muted small">CompTIA does not publish how it scales scores, so the scaled score here is an estimate: the share of points you earned mapped onto 100&ndash;900.</p>
      </div>
      <div>
        <h2 class="sec-title">Exam domains</h2>
        <table class="weights"><thead><tr><th>Domain</th><th></th><th class="num">Weight</th></tr></thead><tbody>${weights}</tbody></table>
        <p class="muted small">Every mock follows these weights: 14, 22, 17, 25 and 12 items out of 90.</p>
      </div>
    </section>
  </main>${siteFooter()}`;
}

// the lowest-scoring domain of an attempt, for the exam card (attempts saved before 2026-11-27 have no domains)
function weakest(r) {
  if (!r.domains) return "";
  const [d, p] = Object.entries(r.domains).sort((a, b) => a[1] - b[1])[0] || [];
  if (d === undefined || p >= 100) return "";
  return `<p class="ec-weak">Weakest last time: <b>${d}.0 ${esc(DOMAINS[d].name)}</b>, ${p}%</p>`;
}

/* ---------- exam ---------- */
async function examPage(id) {
  const exam = await loadExam(id);
  if (!exam) { location.hash = "#/"; return; }
  const attempt = store.get(KEY_ATTEMPT(id));
  if (!attempt) return introPage(exam);
  if (attempt.order.some((iid) => !exam.byId.has(iid))) {
    store.del(KEY_ATTEMPT(id));
    return introPage(exam);
  }
  runExam(exam, attempt);
}

function introPage(exam) {
  document.title = `${exam.title} - Security+ SY0-801`;
  const pbqs = exam.items.filter(isPbq).length;
  app.innerHTML = `${siteHeader()}
  <main class="wrap intro">
    <p class="crumbs"><a href="#/">Mock exams</a> / ${esc(exam.title)}</p>
    <h1>${esc(exam.title)}</h1>
    <p class="ec-meta">${esc(fmtDate(exam.date))} &middot; ${exam.items.length} items &middot; ${exam.minutes} minutes &middot; ${pbqs} performance-based</p>
    <div class="intro-box">
      <h2>Before you begin</h2>
      <ul class="rules">
        <li>You have <b>${exam.minutes} minutes</b> for ${exam.items.length} items. The time remaining is shown at the top right.</li>
        <li>The first ${pbqs} items are performance-based. You can skip them with Next and come back from the review screen.</li>
        <li>Use <b>Flag for review</b> on any item you want to look at again. The review screen lists every item as answered, incomplete or flagged.</li>
        <li>Right-click an option, or press its strike button, to strike it out while you narrow the choices.</li>
        <li>Nothing is scored until you end the exam or the time runs out. You can leave and resume later in this browser.</li>
        <li>Keyboard: <kbd>Alt</kbd>+<kbd>N</kbd> next, <kbd>Alt</kbd>+<kbd>P</kbd> previous, <kbd>Alt</kbd>+<kbd>F</kbd> flag, <kbd>Alt</kbd>+<kbd>R</kbd> review screen.</li>
      </ul>
    </div>
    <div class="intro-actions"><button class="btn primary big" id="begin">Begin exam</button> <a class="btn" href="#/">Back</a></div>
  </main>${siteFooter()}`;
  $("#begin").onclick = () => {
    const a = newAttempt(exam);
    saveAttempt(a);
    runExam(exam, a);
  };
}

function runExam(exam, a) {
  document.title = `${exam.title} - Security+ SY0-801`;
  document.body.classList.add("in-exam");
  let view = "item";
  let reviewFilter = "all";
  let picked = null;

  app.innerHTML = `
  <div class="xbar">
    <div class="xbar-in">
      <div class="x-title"><span class="x-name">Security+ SY0-801</span><span class="x-sub">${esc(exam.title)}</span></div>
      <div class="x-right">
        <div class="x-count" id="x-count"></div>
        <div class="x-time" id="x-time" role="timer" aria-label="Time remaining"></div>
      </div>
    </div>
  </div>
  <div class="xtools" id="xtools">
    <div class="xtools-in">
      <button class="flag-btn" id="flag" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1v14M3 2h9l-2 3 2 3H3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span>Flag for review</span></button>
      <span class="x-hint" id="x-hint"></span>
    </div>
  </div>
  <main class="xmain" id="xmain"></main>
  <nav class="xnav" aria-label="Exam navigation">
    <div class="xnav-in">
      <button class="btn" id="prev">Previous</button>
      <button class="btn" id="review">Review</button>
      <button class="btn primary" id="next">Next</button>
    </div>
  </nav>`;

  const main = $("#xmain");
  const timeEl = $("#x-time");

  /* timer */
  let last = performance.now();
  let saveTick = 0;
  let ended = false;
  if (!a.spent) a.spent = {};
  const tick = () => {
    const now = performance.now();
    if (!document.hidden) {
      a.remaining -= now - last;
      if (view === "item") { const sid = a.order[a.cur]; a.spent[sid] = (a.spent[sid] || 0) + (now - last); }
    }
    last = now;
    showTime();
    if (++saveTick % 5 === 0) saveAttempt(a);
    if (a.remaining <= 0 && !ended) finish(true);
  };
  const showTime = () => {
    timeEl.textContent = clock(a.remaining);
    timeEl.classList.toggle("warn", a.remaining <= 10 * 60000);
    timeEl.classList.toggle("crit", a.remaining <= 5 * 60000);
  };
  const iv = setInterval(tick, 1000);
  const onHide = () => { tick(); saveAttempt(a); };
  const onVis = () => { last = performance.now(); if (document.hidden) saveAttempt(a); };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", onHide);
  const onKey = (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === "n" && view === "item") { e.preventDefault(); go(a.cur + 1); }
    else if (k === "p" && view === "item") { e.preventDefault(); go(a.cur - 1); }
    else if (k === "f" && view === "item") { e.preventDefault(); toggleFlag(); }
    else if (k === "r") { e.preventDefault(); showReview("all"); }
  };
  document.addEventListener("keydown", onKey);
  stopTimer = () => {
    clearInterval(iv);
    tick();
    if (!ended) saveAttempt(a);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("keydown", onKey);
  };
  showTime();

  $("#prev").onclick = () => (view === "review" ? go(a.cur) : go(a.cur - 1));
  $("#next").onclick = () => {
    if (a.cur >= a.order.length - 1) showReview("all"); else go(a.cur + 1);
  };
  $("#review").onclick = () => (view === "review" ? endExam() : showReview("all"));
  $("#flag").onclick = toggleFlag;

  function toggleFlag() {
    const id = a.order[a.cur];
    if (a.flags[id]) delete a.flags[id]; else a.flags[id] = true;
    saveAttempt(a);
    paintFlag();
  }
  function paintFlag() {
    const on = !!a.flags[a.order[a.cur]];
    const b = $("#flag");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.classList.toggle("on", on);
    $("span", b).textContent = on ? "Flagged for review" : "Flag for review";
  }

  function go(i) {
    if (i < 0) return;
    if (i >= a.order.length) { showReview("all"); return; }
    a.cur = i;
    view = "item";
    picked = null;
    saveAttempt(a);
    renderItem();
  }

  function setNav() {
    const item = view === "item";
    $("#xtools").hidden = !item;
    $("#prev").textContent = item ? "Previous" : "Back to item";
    $("#prev").disabled = item && a.cur === 0;
    $("#next").textContent = a.cur === a.order.length - 1 ? "Review" : "Next";
    $("#next").hidden = !item;
    $("#review").textContent = item ? "Review" : "End exam";
    $("#review").classList.toggle("danger", !item);
    $("#x-count").textContent = item ? `Item ${a.cur + 1} of ${a.order.length}` : `Review: ${a.order.length} items`;
  }

  function renderItem() {
    setNav();
    paintFlag();
    const id = a.order[a.cur];
    const item = exam.byId.get(id);
    a.visited[id] = true;
    const v = a.answers[id];
    let body = "";
    const ex = exhibitHtml(item);
    if (item.type === "single" || item.type === "multi") {
      $("#x-hint").textContent = item.type === "multi" ? `Select ${item.choose}.` : "";
      const perm = a.perm[id];
      const struck = new Set(a.struck[id] || []);
      const sel = item.type === "multi" ? new Set(v || []) : new Set(typeof v === "number" ? [v] : []);
      const kind = item.type === "multi" ? "checkbox" : "radio";
      body = `<div class="stem">${item.stem}</div>${ex}
        ${item.type === "multi" ? `<p class="choose">Choose ${["", "one", "two", "three", "four"][item.choose] || item.choose}.</p>` : ""}
        <div class="opts" role="${kind === "radio" ? "radiogroup" : "group"}" aria-label="Answer options">
        ${perm.map((o, pos) => `
          <div class="opt ${sel.has(o) ? "sel" : ""} ${struck.has(o) ? "struck" : ""}" data-o="${o}">
            <label><input type="${kind}" name="ans" value="${o}" ${sel.has(o) ? "checked" : ""}>
              <span class="letter">${LETTERS[pos]}.</span><span class="otext">${item.options[o]}</span></label>
            <button type="button" class="strike" aria-pressed="${struck.has(o)}" title="Strike out this option" aria-label="Strike out option ${LETTERS[pos]}"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.6 12.4l8.8-8.8" stroke="currentColor" stroke-width="1.4"/></svg></button>
          </div>`).join("")}
        </div>
        <p class="too-many" id="too-many" hidden>You have already selected ${item.choose || 1}. Clear one to choose another.</p>`;
      main.innerHTML = `<div class="item-wrap"><div class="qnum">Item ${a.cur + 1}</div>${body}</div>`;
      wireOptions(item);
    } else {
      $("#x-hint").textContent = "Performance-based";
      main.innerHTML = `<div class="item-wrap pbq-wrap">
        <div class="pbq-bar"><span class="qnum">Item ${a.cur + 1} &middot; Performance-based</span>
          <span class="pbq-tools"><button class="link-btn" id="pbq-q" aria-expanded="true">Hide question</button> <button class="link-btn" id="pbq-reset">Reset all answers</button></span></div>
        <div class="stem" id="pbq-stem">${item.stem}</div>${ex}
        <div class="pbq" id="pbq"></div></div>`;
      $("#pbq-q").onclick = (e) => {
        const st = $("#pbq-stem");
        st.hidden = !st.hidden;
        e.target.textContent = st.hidden ? "Show question" : "Hide question";
        e.target.setAttribute("aria-expanded", String(!st.hidden));
      };
      $("#pbq-reset").onclick = async () => {
        const ok = await ask("Reset all answers", "<p>Clear everything you have entered in this item?</p>", [{ label: "Cancel", value: false }, { label: "Reset", value: true, primary: true }]);
        if (!ok) return;
        delete a.answers[id];
        saveAttempt(a);
        renderItem();
      };
      renderPbq(item);
    }
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }

  function wireOptions(item) {
    const id = item.id;
    for (const row of $$(".opt", main)) {
      const o = Number(row.dataset.o);
      const input = $("input", row);
      input.addEventListener("click", (e) => {
        if (item.type === "single") {
          a.answers[id] = o;
        } else {
          const cur = new Set(a.answers[id] || []);
          if (cur.has(o)) cur.delete(o);
          else {
            if (cur.size >= item.choose) { e.preventDefault(); $("#too-many").hidden = false; return; }
            cur.add(o);
          }
          a.answers[id] = [...cur];
        }
        $("#too-many").hidden = true;
        unstrike(id, o);
        saveAttempt(a);
        paintOptions(item);
      });
      const strike = () => {
        const s = new Set(a.struck[id] || []);
        if (s.has(o)) s.delete(o); else s.add(o);
        a.struck[id] = [...s];
        saveAttempt(a);
        paintOptions(item);
      };
      $(".strike", row).onclick = strike;
      row.addEventListener("contextmenu", (e) => { e.preventDefault(); strike(); });
    }
  }
  function unstrike(id, o) {
    if (a.struck[id]) a.struck[id] = a.struck[id].filter((x) => x !== o);
  }
  function paintOptions(item) {
    const v = a.answers[item.id];
    const sel = item.type === "multi" ? new Set(v || []) : new Set(typeof v === "number" ? [v] : []);
    const struck = new Set(a.struck[item.id] || []);
    for (const row of $$(".opt", main)) {
      const o = Number(row.dataset.o);
      row.classList.toggle("sel", sel.has(o));
      row.classList.toggle("struck", struck.has(o));
      $("input", row).checked = sel.has(o);
      $(".strike", row).setAttribute("aria-pressed", String(struck.has(o)));
    }
  }

  /* ----- PBQs ----- */
  function renderPbq(item) {
    const box = $("#pbq");
    if (item.kind === "match") return renderMatch(item, box);
    if (item.kind === "order") return renderOrder(item, box);
    if (item.kind === "table") return renderTable(item, box);
  }

  function renderMatch(item, box) {
    const id = item.id;
    const v = a.answers[id] || item.slots.map(() => null);
    const used = new Set(v.filter((x) => x !== null));
    const bank = item.pool.map((t, i) => (item.reuse || !used.has(i))
      ? `<button type="button" class="token ${picked === i ? "picked" : ""}" draggable="true" data-t="${i}">${esc(t)}</button>` : "").join("");
    box.innerHTML = `
      <div class="match">
        <div class="bank" id="bank" aria-label="${esc(item.poolHead || "Choices")}">
          <div class="bank-h">${esc(item.poolHead || "Choices")}${item.reuse ? ` <span class="muted">(each can be used more than once)</span>` : ""}</div>
          <div class="bank-tokens">${bank || `<span class="muted small">All placed.</span>`}</div>
        </div>
        <div class="slots">
          <div class="slots-h"><span>${esc(item.slotHead || "Item")}</span><span>${esc(item.targetHead || "Your answer")}</span></div>
          ${item.slots.map((s, i) => `
            <div class="slot-row">
              <div class="slot-label">${s.label}</div>
              <button type="button" class="slot ${v[i] !== null ? "filled" : ""}" data-s="${i}" aria-label="Answer for row ${i + 1}">${v[i] !== null ? esc(item.pool[v[i]]) : `<span class="ph">Drop or tap to place</span>`}</button>
            </div>`).join("")}
        </div>
      </div>
      <p class="muted small pbq-help">Drag a choice onto a row, or tap a choice and then tap the row. Tap a placed answer to take it back.</p>`;

    const place = (slot, tok) => {
      const cur = (a.answers[id] || item.slots.map(() => null)).slice();
      if (!item.reuse) for (let j = 0; j < cur.length; j++) if (cur[j] === tok) cur[j] = null;
      cur[slot] = tok;
      a.answers[id] = cur;
      picked = null;
      saveAttempt(a);
      renderMatch(item, box);
    };
    const clear = (slot) => {
      const cur = (a.answers[id] || item.slots.map(() => null)).slice();
      cur[slot] = null;
      a.answers[id] = cur;
      saveAttempt(a);
      renderMatch(item, box);
    };
    for (const t of $$(".token", box)) {
      t.onclick = () => { picked = picked === Number(t.dataset.t) ? null : Number(t.dataset.t); renderMatch(item, box); };
      t.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", `t:${t.dataset.t}`); e.dataTransfer.effectAllowed = "move"; });
    }
    for (const s of $$(".slot", box)) {
      const i = Number(s.dataset.s);
      s.onclick = () => {
        if (picked !== null) place(i, picked);
        else if (v[i] !== null) clear(i);
      };
      if (v[i] !== null) {
        s.draggable = true;
        s.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", `s:${i}`); });
      }
      s.addEventListener("dragover", (e) => { e.preventDefault(); s.classList.add("over"); });
      s.addEventListener("dragleave", () => s.classList.remove("over"));
      s.addEventListener("drop", (e) => {
        e.preventDefault();
        const d = e.dataTransfer.getData("text/plain");
        if (d.startsWith("t:")) place(i, Number(d.slice(2)));
        else if (d.startsWith("s:")) {
          const from = Number(d.slice(2));
          if (from === i) return;
          const cur = (a.answers[id] || item.slots.map(() => null)).slice();
          const tok = cur[from];
          cur[from] = cur[i];
          cur[i] = tok;
          a.answers[id] = cur;
          saveAttempt(a);
          renderMatch(item, box);
        }
      });
    }
    const bankEl = $("#bank", box);
    bankEl.addEventListener("dragover", (e) => e.preventDefault());
    bankEl.addEventListener("drop", (e) => {
      e.preventDefault();
      const d = e.dataTransfer.getData("text/plain");
      if (d.startsWith("s:")) clear(Number(d.slice(2)));
    });
  }

  function renderOrder(item, box) {
    const id = item.id;
    const cur = a.answers[id] || a.perm[id];
    box.innerHTML = `
      <div class="order-h">${esc(item.orderHead || "Put these in order, first at the top")}</div>
      <ol class="order" id="order">
        ${cur.map((s, pos) => `<li class="order-row" draggable="true" data-pos="${pos}">
          <span class="grip" aria-hidden="true"><svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg></span>
          <span class="order-n">${pos + 1}</span><span class="order-t">${esc(item.steps[s])}</span>
          <span class="order-btns"><button type="button" class="mini" data-up="${pos}" aria-label="Move up" ${pos === 0 ? "disabled" : ""}>&uarr;</button><button type="button" class="mini" data-down="${pos}" aria-label="Move down" ${pos === cur.length - 1 ? "disabled" : ""}>&darr;</button></span>
        </li>`).join("")}
      </ol>
      <p class="muted small pbq-help">Drag a step, or use the arrows. ${a.answers[id] ? "" : "The item counts as answered once you have moved a step."}</p>`;
    const move = (from, to) => {
      const arr = (a.answers[id] || a.perm[id]).slice();
      const [x] = arr.splice(from, 1);
      arr.splice(to, 0, x);
      a.answers[id] = arr;
      saveAttempt(a);
      renderOrder(item, box);
      $(`.order-row[data-pos="${to}"] .mini`, box)?.focus();
    };
    for (const b of $$("[data-up]", box)) b.onclick = () => move(Number(b.dataset.up), Number(b.dataset.up) - 1);
    for (const b of $$("[data-down]", box)) b.onclick = () => move(Number(b.dataset.down), Number(b.dataset.down) + 1);
    for (const li of $$(".order-row", box)) {
      li.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", li.dataset.pos));
      li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("over"); });
      li.addEventListener("dragleave", () => li.classList.remove("over"));
      li.addEventListener("drop", (e) => { e.preventDefault(); move(Number(e.dataTransfer.getData("text/plain")), Number(li.dataset.pos)); });
    }
  }

  function renderTable(item, box) {
    const id = item.id;
    const v = a.answers[id] || {};
    box.innerHTML = `<div class="tbl-wrap"><table class="pbq-table">
      <thead><tr>${item.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${item.rows.map((row, r) => `<tr>${row.map((cell, c) => {
        if (cell && typeof cell === "object") {
          const key = `${r}:${c}`;
          return `<td><select data-k="${key}" aria-label="${esc(item.columns[c])} for row ${r + 1}"><option value="">Select</option>${cell.opts.map((o) => `<option ${v[key] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></td>`;
        }
        return `<td>${esc(cell)}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>`;
    for (const s of $$("select", box)) {
      s.onchange = () => {
        const cur = { ...(a.answers[id] || {}) };
        if (s.value) cur[s.dataset.k] = s.value; else delete cur[s.dataset.k];
        a.answers[id] = cur;
        saveAttempt(a);
      };
    }
  }

  /* ----- review screen ----- */
  function showReview(filter) {
    view = "review";
    reviewFilter = filter || reviewFilter;
    setNav();
    const rows = a.order.map((id, i) => {
      const item = exam.byId.get(id);
      const done = answered(item, a.answers[id]);
      return { i, id, item, done, flag: !!a.flags[id] };
    });
    const inc = rows.filter((r) => !r.done).length;
    const fl = rows.filter((r) => r.flag).length;
    const shown = rows.filter((r) => reviewFilter === "all" || (reviewFilter === "incomplete" && !r.done) || (reviewFilter === "flagged" && r.flag));
    main.innerHTML = `<div class="review">
      <h1>Item review</h1>
      <p class="muted">Select an item to return to it. Time keeps running on this screen.</p>
      <div class="rv-sum"><span><b>${rows.length - inc}</b> answered</span><span><b>${inc}</b> incomplete</span><span><b>${fl}</b> flagged</span></div>
      <div class="rv-filter" role="tablist">
        ${[["all", `All (${rows.length})`], ["incomplete", `Incomplete (${inc})`], ["flagged", `Flagged (${fl})`]].map(([k, l]) =>
          `<button role="tab" class="chip ${reviewFilter === k ? "on" : ""}" aria-selected="${reviewFilter === k}" data-f="${k}">${l}</button>`).join("")}
      </div>
      <div class="rv-grid">${shown.length ? shown.map((r) => `
        <button class="rv-cell ${r.done ? "done" : "inc"} ${r.flag ? "flag" : ""}" data-i="${r.i}" aria-label="Item ${r.i + 1}, ${r.done ? "answered" : "incomplete"}${r.flag ? ", flagged" : ""}">
          <span class="rv-n">${r.i + 1}</span>
          <span class="rv-s">${r.done ? "Answered" : "Incomplete"}${isPbq(r.item) ? `<span class="rv-p">PBQ</span>` : ""}</span>
          ${r.flag ? `<svg class="rv-f" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1v14M3 2h9l-2 3 2 3H3" fill="currentColor" stroke="currentColor" stroke-width="1.2"/></svg>` : ""}
        </button>`).join("") : `<p class="muted">No items in this list.</p>`}
      </div>
      <div class="rv-actions">
        <button class="btn" data-walk="all">Review all</button>
        <button class="btn" data-walk="incomplete" ${inc ? "" : "disabled"}>Review incomplete</button>
        <button class="btn" data-walk="flagged" ${fl ? "" : "disabled"}>Review flagged</button>
      </div>
    </div>`;
    for (const b of $$(".rv-cell", main)) b.onclick = () => go(Number(b.dataset.i));
    for (const b of $$("[data-f]", main)) b.onclick = () => showReview(b.dataset.f);
    for (const b of $$("[data-walk]", main)) b.onclick = () => {
      const pick = rows.find((r) => b.dataset.walk === "all" || (b.dataset.walk === "incomplete" && !r.done) || (b.dataset.walk === "flagged" && r.flag));
      if (pick) go(pick.i);
    };
    window.scrollTo(0, 0);
  }

  async function endExam() {
    const inc = a.order.filter((id) => !answered(exam.byId.get(id), a.answers[id])).length;
    const fl = Object.keys(a.flags).length;
    const ok = await ask("End the exam?",
      `<p>Once you end the exam it is scored and you cannot change any answer.</p>
       ${inc ? `<p class="warn-line">${inc} item${inc > 1 ? "s are" : " is"} incomplete.</p>` : ""}
       ${fl ? `<p>${fl} item${fl > 1 ? "s are" : " is"} flagged for review.</p>` : ""}
       <p>Time remaining: ${clock(a.remaining)}.</p>`,
      [{ label: "Return to the exam", value: false }, { label: "End exam", value: true, primary: true }]);
    if (ok) finish(false);
  }

  async function finish(timeUp) {
    if (ended) return;
    ended = true;
    a.remaining = Math.max(0, a.remaining);
    const g = gradeAttempt(exam, a);
    const all = results();
    const list = all[exam.id] || [];
    list.push({
      date: new Date().toISOString(), scaled: g.scaled, pass: g.pass, earned: g.earned, total: g.total, full: g.full,
      used: exam.minutes * 60000 - a.remaining, timeUp, order: a.order, answers: a.answers, flags: a.flags,
      spent: Object.fromEntries(Object.entries(a.spent || {}).map(([k, ms]) => [k, Math.round(ms / 1000)])),
      domains: Object.fromEntries(Object.entries(g.byDomain).map(([d, x]) => [d, x.total ? Math.round((100 * x.earned) / x.total) : 0])),
    });
    all[exam.id] = list;
    store.set(KEY_RESULTS, all);
    store.del(KEY_ATTEMPT(exam.id));
    if (stopTimer) { stopTimer(); stopTimer = null; }
    if (timeUp) {
      await ask("Time is up", "<p>The exam time has run out. Your answers have been scored.</p>", [{ label: "See the score report", value: true, primary: true }]);
    }
    location.hash = `#/result/${exam.id}/${list.length - 1}`;
  }

  const startAt = Math.min(a.cur || 0, a.order.length - 1);
  go(startAt);
}

function exhibitHtml(item) {
  if (!item.exhibit) return "";
  const list = Array.isArray(item.exhibit) ? item.exhibit : [item.exhibit];
  return list.map((x) => {
    let inner = "";
    if (x.pre) inner = `<pre>${esc(x.pre)}</pre>`;
    else if (x.table) inner = `<div class="tbl-wrap"><table class="ex-table"><thead><tr>${x.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${x.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    else if (x.html) inner = x.html;
    return `<figure class="exhibit"><figcaption>${esc(x.title || "Exhibit")}</figcaption>${inner}</figure>`;
  }).join("");
}

/* ---------- results ---------- */
async function resultPage(id, n) {
  const exam = await loadExam(id);
  const list = (results()[id] || []);
  const r = list[n];
  if (!exam || !r) { location.hash = "#/"; return; }
  document.title = `${exam.title} score report - Security+ SY0-801`;
  const attempt = { order: r.order.filter((iid) => exam.byId.has(iid)), answers: r.answers, flags: r.flags || {} };
  const g = gradeAttempt(exam, attempt);
  const pct = (x) => (x.total ? Math.round((100 * x.earned) / x.total) : 0);
  const domRows = Object.entries(DOMAINS).map(([d, info]) => {
    const x = g.byDomain[d] || { earned: 0, total: 0, items: 0 };
    const p = pct(x);
    return `<tr><td class="dn">${d}.0 ${esc(info.name)}</td><td class="num">${x.items}</td>
      <td class="barcell"><div class="bar"><span style="width:${p}%" class="${p >= 81 ? "ok" : p >= 65 ? "mid" : "bad"}"></span></div></td><td class="num">${p}%</td></tr>`;
  }).join("");
  const spent = r.spent || null;
  const sumSec = (pred) => attempt.order.filter((iid) => pred(exam.byId.get(iid))).reduce((s, iid) => s + (spent[iid] || 0), 0);
  const mcqCount = attempt.order.filter((iid) => !isPbq(exam.byId.get(iid))).length;
  const timeFacts = spent ? `
        <div><dt>Time on performance-based items</dt><dd>${mins(sumSec(isPbq) * 1000)}</dd></div>
        <div><dt>Average per multiple-choice item</dt><dd>${mmss(mcqCount ? (sumSec((it) => !isPbq(it)) * 1000) / mcqCount : 0)}</dd></div>` : "";
  const missed = g.missed.map((o) => `<li><b>${o}</b> ${esc(OBJECTIVES[o] || "")}</li>`).join("");

  app.innerHTML = `${siteHeader()}
  <main class="wrap report">
    <p class="crumbs"><a href="#/">Mock exams</a> / ${esc(exam.title)} / Score report</p>
    <section class="score-card ${g.pass ? "pass" : "fail"}">
      <div class="sc-main">
        <div class="sc-label">Your score</div>
        <div class="sc-num">${g.scaled}</div>
        <div class="sc-scale">on a scale of 100&ndash;900 &middot; passing score ${PASS}</div>
        <div class="sc-verdict">${g.pass ? "Passed" : "Not passed"}</div>
      </div>
      <dl class="sc-facts">
        <div><dt>Items fully correct</dt><dd>${g.full} of ${g.count}</dd></div>
        <div><dt>Points</dt><dd>${g.earned.toFixed(1)} of ${g.total}</dd></div>
        <div><dt>Time used</dt><dd>${mins(r.used)} of ${exam.minutes} min${r.timeUp ? " (time ran out)" : ""}</dd></div>
        <div><dt>Taken</dt><dd>${esc(new Date(r.date).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))}</dd></div>${timeFacts}
      </dl>
    </section>
    <p class="muted small">The scaled score is an estimate (points earned mapped onto 100&ndash;900). Performance-based items give partial credit; multiple-choice items are all or nothing.</p>

    <section class="two">
      <div>
        <h2 class="sec-title">By domain</h2>
        <table class="dom"><thead><tr><th>Domain</th><th class="num">Items</th><th></th><th class="num">Score</th></tr></thead><tbody>${domRows}</tbody></table>
      </div>
      <div>
        <h2 class="sec-title">Exam objectives to review</h2>
        <p class="muted small">As on the real score report: the objectives behind every item you did not get fully right.</p>
        ${missed ? `<ul class="missed">${missed}</ul>` : `<p>None. Every item was fully correct.</p>`}
      </div>
    </section>

    <section>
      <div class="rev-head"><h2 class="sec-title">Every item with its explanation</h2>
        <div class="rv-filter" id="rf">
          <button class="chip on" data-f="all">All</button>
          <button class="chip" data-f="wrong">Not fully correct (${g.count - g.full})</button>
          <button class="chip" data-f="flag">Flagged (${Object.keys(attempt.flags).length})</button>
          <button class="chip" data-f="pbq">Performance-based</button>
        </div></div>
      <div id="rev-list"></div>
    </section>
    <div class="report-actions"><a class="btn primary" href="#/exam/${exam.id}">Take this exam again</a> <a class="btn" href="#/">All mock exams</a></div>
  </main>${siteFooter()}`;

  const listEl = $("#rev-list");
  const paint = (f) => {
    listEl.innerHTML = attempt.order.map((iid, i) => {
      const item = exam.byId.get(iid);
      const gi = g.per[iid];
      if (f === "wrong" && gi.full) return "";
      if (f === "flag" && !attempt.flags[iid]) return "";
      if (f === "pbq" && !isPbq(item)) return "";
      return reviewCard(item, i, attempt.answers[iid], gi, !!attempt.flags[iid], spent ? spent[iid] || 0 : null);
    }).join("") || `<p class="muted">No items in this list.</p>`;
  };
  paint("all");
  for (const b of $$("#rf .chip")) b.onclick = () => {
    $$("#rf .chip").forEach((x) => x.classList.toggle("on", x === b));
    paint(b.dataset.f);
  };
}

function reviewCard(item, i, v, g, flagged, secs) {
  const status = g.full ? `<span class="res ok">Correct</span>` : g.score > 0 ? `<span class="res mid">Partly correct (${g.score.toFixed(1)} of ${g.max})</span>` : `<span class="res bad">${v === undefined ? "Not answered" : "Incorrect"}</span>`;
  let body = "";
  if (item.type === "single" || item.type === "multi") {
    const sel = new Set(item.type === "multi" ? (v || []) : (typeof v === "number" ? [v] : []));
    const right = new Set(item.type === "multi" ? item.answer : [item.answer]);
    body = `<ul class="rv-opts">${item.options.map((o, k) => {
      const cls = right.has(k) ? "right" : sel.has(k) ? "wrong" : "";
      const tag = right.has(k) ? `<span class="otag">Correct answer</span>` : "";
      const mine = sel.has(k) ? `<span class="otag mine">Your answer</span>` : "";
      return `<li class="${cls}"><span class="letter">${LETTERS[k]}.</span><span class="otext">${o}</span>${tag}${mine}</li>`;
    }).join("")}</ul>`;
  } else if (item.kind === "match") {
    body = `<table class="rv-pbq"><thead><tr><th>${esc(item.slotHead || "Item")}</th><th>Your answer</th><th>Correct</th></tr></thead><tbody>${item.slots.map((s, k) => {
      const mine = Array.isArray(v) && v[k] !== null && v[k] !== undefined ? item.pool[v[k]] : "(blank)";
      const ok = Array.isArray(v) && v[k] === s.answer;
      return `<tr class="${ok ? "right" : "wrong"}"><td>${s.label}</td><td>${esc(mine)}</td><td>${esc(item.pool[s.answer])}</td></tr>`;
    }).join("")}</tbody></table>`;
  } else if (item.kind === "order") {
    const mine = Array.isArray(v) ? v : null;
    body = `<table class="rv-pbq"><thead><tr><th>#</th><th>Your order</th><th>Correct order</th></tr></thead><tbody>${item.steps.map((s, k) => {
      const ok = mine && mine[k] === k;
      return `<tr class="${ok ? "right" : "wrong"}"><td>${k + 1}</td><td>${mine ? esc(item.steps[mine[k]]) : "(not answered)"}</td><td>${esc(s)}</td></tr>`;
    }).join("")}</tbody></table>`;
  } else if (item.kind === "table") {
    const cells = cellsOf(item);
    body = `<table class="rv-pbq"><thead><tr><th>Field</th><th>Your answer</th><th>Correct</th></tr></thead><tbody>${cells.map((c) => {
      const mine = v && v[c.key] ? v[c.key] : "(blank)";
      const ok = v && v[c.key] === c.cell.answer;
      return `<tr class="${ok ? "right" : "wrong"}"><td>Row ${esc(item.rows[c.r][0])}: ${esc(item.columns[c.c])}</td><td>${esc(mine)}</td><td>${esc(c.cell.answer)}</td></tr>`;
    }).join("")}</tbody></table>`;
  }
  return `<article class="rv-card ${g.full ? "ok" : "bad"}">
    <header class="rv-card-h"><span class="qnum">Item ${i + 1}${isPbq(item) ? " &middot; Performance-based" : ""}</span>${flagged ? `<span class="fl">Flagged</span>` : ""}${status}${secs === null || secs === undefined ? "" : `<span class="tspent" title="Time spent on this item">${mmss(secs * 1000)}</span>`}<span class="obj" title="${esc(OBJECTIVES[item.obj] || "")}">Objective ${item.obj}</span></header>
    <div class="stem">${item.stem}</div>${exhibitHtml(item)}
    ${body}
    <div class="explain"><h4>Explanation</h4>${item.explain}</div>
  </article>`;
}

/* ---------- version check ---------- */
async function checkVersion() {
  const build = document.querySelector('meta[name="build"]')?.content;
  if (!build || build === "dev") return;
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const { version } = await r.json();
    if (version && version !== build) {
      const el = document.getElementById("update");
      el.hidden = false;
      document.getElementById("update-reload").onclick = () => location.reload();
    }
  } catch { /* offline */ }
}
setInterval(checkVersion, 5 * 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });

route();
