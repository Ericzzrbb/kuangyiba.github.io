/* ============================================================
 * 猜球员 · 界面与游戏流程（中英双语 / 13 回合 / 提示）
 * 依赖：data-tables.js、i18n.js、game-logic.js
 * ============================================================ */
"use strict";

const CSV_ZH = "database/players.csv";
const CSV_EN = "database/players-en.csv";
const MAX_SUGGESTIONS = 8;
const STATS_KEY = "guess-player-stats";
const LANG_KEY = "guess-player-lang";

const GL = window.GuessLogic;
const { RULES } = GL;

const state = {
  players: [],
  target: null,
  history: [], // 已猜球员 id，按时间顺序
  guessedIds: new Set(),
  over: false,
  result: null, // 'win' | 'rounds' | 'reveal'
  rounds: 0,
  hintsLeft: RULES.HINTS_PER_ROUND,
  revealedHints: [], // 已揭示的字段名
  suggestions: [],
  activeIndex: -1,
  lang: "zh",
  stats: loadStats(),
};

const el = {};
[
  "guess-form", "guess-input", "guess-submit", "suggest", "hint", "guess-rows", "empty-hint",
  "counter", "banner", "new-game", "reveal", "hint-btn", "hints-box", "hints-title", "hint-chips",
  "stat-plays", "stat-wins", "stat-best", "stat-plays-label", "stat-wins-label", "stat-best-label",
  "loading", "fatal", "title-a", "title-b", "tagline", "rules-summary", "rules-list", "footer-text",
  "th-player", "th-height", "th-nation", "th-club", "th-foot", "th-position", "th-type",
].forEach((id) => {
  el[id] = document.getElementById(id);
});

const S = () => STRINGS[state.lang];
const isZh = () => state.lang === "zh";
const t = (obj) => obj[state.lang];

/* ---------------- 战绩（跨语言共用） ---------------- */

function loadStats() {
  const empty = { plays: 0, wins: 0, best: null };
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      plays: Number(parsed.plays) || 0,
      wins: Number(parsed.wins) || 0,
      best: parsed.best == null ? null : Number(parsed.best),
    };
  } catch (err) {
    return empty;
  }
}

function saveStats() {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(state.stats));
  } catch (err) {
    /* 隐私模式忽略 */
  }
  renderStats();
}

function renderStats() {
  el["stat-plays"].textContent = state.stats.plays;
  el["stat-wins"].textContent = state.stats.wins;
  el["stat-best"].textContent = state.stats.best == null ? "—" : state.stats.best;
}

/* ---------------- 语言 ---------------- */

function loadLang() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (fromUrl === "zh" || fromUrl === "en") return fromUrl;
  } catch (err) {
    /* 忽略 */
  }
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch (err) {
    /* 忽略 */
  }
  return "zh";
}

function applyI18n() {
  const s = S();
  document.documentElement.lang = isZh() ? "zh-CN" : "en";
  document.title = s.docTitle;

  el["title-a"].textContent = s.titleA;
  el["title-b"].textContent = s.titleB;
  el.tagline.textContent = s.tagline(state.players.length);
  el["stat-plays-label"].textContent = s.statPlays;
  el["stat-wins-label"].textContent = s.statWins;
  el["stat-best-label"].textContent = s.statBest;
  el["guess-input"].placeholder = s.placeholder;
  el["guess-submit"].textContent = s.submit;
  el.reveal.textContent = s.reveal;
  el["new-game"].textContent = s.newGame;
  el.loading.textContent = s.loading;
  el["empty-hint"].textContent = s.emptyHint;
  el["rules-summary"].textContent = s.rulesSummary;
  el["footer-text"].textContent = s.footer(state.players.length);

  el["hints-title"].textContent = s.hintsTitle;
  el["th-player"].textContent = s.tableHead.player;
  el["th-height"].textContent = s.tableHead.height;
  el["th-nation"].textContent = s.tableHead.nation;
  el["th-club"].textContent = s.tableHead.club;
  el["th-foot"].textContent = s.tableHead.foot;
  el["th-position"].textContent = s.tableHead.position;
  el["th-type"].textContent = s.tableHead.type;

  el["rules-list"].innerHTML = "";
  s.rules.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    el["rules-list"].append(li);
  });

  document.querySelectorAll(".lang-btn").forEach((btn) => {
    const active = btn.dataset.lang === state.lang;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
    btn.textContent = btn.dataset.lang === "zh" ? s.langZh : s.langEn;
  });
}

function setLang(lang, opts) {
  if (lang !== "zh" && lang !== "en") return;
  state.lang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch (err) {
    /* 忽略 */
  }
  // 让地址栏带上语言，方便分享 / 直接打开英文版
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", lang);
    window.history.replaceState(null, "", url);
  } catch (err) {
    /* 忽略 */
  }
  applyI18n();
  renderAll();
  if (!state.over && !(opts && opts.silent)) el["guess-input"].focus();
}

/* ---------------- 候选下拉框 ---------------- */

function highlight(name, query) {
  const q = query.trim();
  const idx = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (idx < 0) return document.createTextNode(name);
  const frag = document.createDocumentFragment();
  frag.append(name.slice(0, idx));
  const mark = document.createElement("mark");
  mark.textContent = name.slice(idx, idx + q.length);
  frag.append(mark, name.slice(idx + q.length));
  return frag;
}

function renderSuggestions(query) {
  state.suggestions = GL.searchPlayers(state.players, query, MAX_SUGGESTIONS);
  state.activeIndex = -1;
  el.suggest.innerHTML = "";

  if (!query.trim()) {
    el.suggest.hidden = true;
    if (el.hint.textContent === S().noMatch) el.hint.textContent = "";
    return;
  }
  if (!state.suggestions.length) {
    el.suggest.hidden = true;
    el.hint.textContent = S().noMatch;
    return;
  }
  if (el.hint.textContent === S().noMatch) el.hint.textContent = "";

  state.suggestions.forEach((p, i) => {
    const item = document.createElement("li");
    item.className = "suggest-item";
    item.setAttribute("role", "option");
    item.dataset.index = String(i);

    const left = document.createElement("span");
    left.className = "suggest-name";
    left.append(highlight(t(p.name), query));

    const right = document.createElement("span");
    right.className = "suggest-meta";
    right.textContent = `${t(p.position)} · ${t(p.club)} · ${t(p.type)}`;

    item.append(left, right);
    item.addEventListener("pointerdown", (e) => {
      e.preventDefault(); // 保持输入框焦点，避免 blur 抢先隐藏
      chooseSuggestion(i);
    });
    el.suggest.append(item);
  });
  el.suggest.hidden = false;
}

function chooseSuggestion(index) {
  const p = state.suggestions[index];
  if (!p) return;
  el["guess-input"].value = t(p.name);
  el["guess-input"].dataset.chosenId = String(p.id);
  el.suggest.hidden = true;
  state.activeIndex = -1;
  el["guess-submit"].classList.add("ready");
  el["guess-input"].focus();
}

function moveActive(step) {
  if (el.suggest.hidden || !state.suggestions.length) return;
  const total = state.suggestions.length;
  state.activeIndex = (state.activeIndex + step + total) % total;
  [...el.suggest.children].forEach((node, i) => {
    node.classList.toggle("active", i === state.activeIndex);
  });
}

/* ---------------- 单元格 ---------------- */

function valueText(player, field) {
  const zh = isZh();
  switch (field) {
    case "height":
      return zh ? `${player.height}cm` : `${player.height} cm`;
    case "nation":
      return t(player.nation);
    case "club":
      return t(player.club);
    case "foot":
      return zh ? `${player.foot.zh}脚` : player.foot.en;
    case "position":
      return t(player.position);
    case "type":
      return t(player.type);
    default:
      return "";
  }
}

function tipText(field, cmp) {
  const s = S();
  const zh = isZh();
  const closeNote = cmp && cmp.cls === "close";
  switch (field) {
    case "height":
      return s.tips.height();
    case "nation":
      return s.tips.nation(closeNote ? GL.label("大洲", cmp.note, state.lang) : zh ? "同一大洲" : "the same continent");
    case "club":
      return s.tips.club(closeNote ? GL.label("联赛", cmp.note, state.lang) : zh ? "同一联赛" : "the same league");
    case "foot":
      return s.tips.foot();
    case "position":
      return s.tips.position(closeNote ? GL.label("分区", cmp.note, state.lang) : zh ? "前场/中场/后场" : "the same third of the pitch");
    case "type":
      return s.tips.type();
    default:
      return "";
  }
}

function makeCell(field, player, cmp) {
  const td = document.createElement("td");
  td.className = `cell cell-${cmp.cls}`;
  const value = document.createElement("span");
  value.className = "cell-value";
  value.textContent = valueText(player, field);
  td.append(value);

  if (cmp.arrow) {
    const arrow = document.createElement("span");
    arrow.className = "cell-arrow";
    arrow.textContent = cmp.arrow === "up" ? "▲" : "▼";
    arrow.title = cmp.arrow === "up" ? S().arrowUp : S().arrowDown;
    td.append(arrow);
  }
  td.title = tipText(field, cmp);
  return td;
}

function renderRow(guess, comparison) {
  const tr = document.createElement("tr");
  tr.className = "guess-row" + (comparison.name.cls === "match" ? " correct" : "");

  const nameTd = document.createElement("td");
  nameTd.className = "cell cell-name";
  nameTd.textContent = t(guess.name);
  tr.append(nameTd);

  ["height", "nation", "club", "foot", "position", "type"].forEach((field) => {
    tr.append(makeCell(field, guess, comparison[field]));
  });
  return tr;
}

/* ---------------- 整块重绘（也在切换语言时调用） ---------------- */

function renderAll() {
  if (!state.target) return; // 数据尚未就绪
  const s = S();

  /* 回合计数 */
  el.counter.textContent = state.rounds === 0
    ? s.counterEmpty
    : s.roundsUsed(Math.min(state.rounds, RULES.MAX_ROUNDS), RULES.MAX_ROUNDS);

  /* 提示按钮文字与可用状态 */
  el["hint-btn"].textContent = s.hintBtn(state.hintsLeft);
  el["hint-btn"].disabled = state.over || state.hintsLeft <= 0;

  /* 已获得提示 */
  if (state.revealedHints.length) {
    el["hints-box"].hidden = false;
    el["hint-chips"].innerHTML = "";
    state.revealedHints.forEach((field) => {
      const li = document.createElement("li");
      li.className = "hint-chip";
      li.textContent = GL.hintText(state.target, field, state.lang);
      el["hint-chips"].append(li);
    });
  } else {
    el["hints-box"].hidden = true;
    el["hint-chips"].innerHTML = "";
  }

  /* 猜测历史（时间正序，最新在最上） */
  el["guess-rows"].innerHTML = "";
  const rows = state.history.map((id) => {
    const guess = state.players[id];
    return renderRow(guess, GL.compareAll(guess, state.target));
  });
  rows.reverse().forEach((tr) => el["guess-rows"].append(tr));
  el["empty-hint"].hidden = state.history.length > 0;

  /* 结果横幅 */
  if (!state.result) {
    el.banner.hidden = true;
    el.banner.className = "banner";
    el.banner.innerHTML = "";
  } else {
    const target = state.target;
    el.banner.hidden = false;
    const won = state.result === "win";
    el.banner.className = `banner ${won ? "banner-win" : "banner-lose"}`;

    const head = document.createElement("span");
    head.className = "banner-head";
    if (won) head.textContent = s.bannerWin(t(target.name));
    else if (state.result === "rounds") head.textContent = s.bannerLoseRounds(t(target.name));
    else head.textContent = s.bannerLoseReveal(t(target.name));

    const meta = document.createElement("span");
    meta.className = "banner-meta";
    meta.textContent = [
      t(target.club),
      t(target.position),
      valueText(target, "height"),
      t(target.nation),
      valueText(target, "foot"),
      t(target.type),
    ].join(" · ");

    el.banner.innerHTML = "";
    el.banner.append(head, meta);
  }

  /* 输入区可用状态 */
  el["guess-input"].disabled = state.over;
  el["guess-submit"].disabled = state.over;
  el.reveal.disabled = state.over;
}

/* ---------------- 游戏流程 ---------------- */

function pickTarget() {
  return state.players[Math.floor(Math.random() * state.players.length)];
}

function resetBoard(countsAsPlay) {
  state.target = pickTarget();
  state.history = [];
  state.guessedIds = new Set();
  state.over = false;
  state.result = null;
  state.rounds = 0;
  state.hintsLeft = RULES.HINTS_PER_ROUND;
  state.revealedHints = [];
  state.suggestions = [];
  state.activeIndex = -1;

  el["guess-input"].value = "";
  el["guess-input"].dataset.chosenId = "";
  el.suggest.hidden = true;
  el["guess-submit"].classList.remove("ready");
  el.hint.textContent = "";
  renderAll();
  if (countsAsPlay) {
    state.stats.plays += 1;
    saveStats();
  }
  el["guess-input"].focus();
}

function finishGame(result) {
  state.over = true;
  state.result = result;
  if (result === "win") {
    state.stats.wins += 1;
    if (state.stats.best == null || state.rounds < state.stats.best) {
      state.stats.best = state.rounds;
    }
    saveStats();
  }
  renderAll();
}

function submitGuess(id) {
  if (state.over) return;
  const guess = state.players[id];
  if (!guess) {
    el.hint.textContent = S().pickFromList;
    return;
  }
  if (state.guessedIds.has(id)) {
    el.hint.textContent = S().dupGuess(t(guess.name));
    return;
  }

  state.guessedIds.add(id);
  state.history.push(id);
  state.rounds += 1;
  const correct = id === state.target.id;

  el["guess-input"].value = "";
  el["guess-input"].dataset.chosenId = "";
  el.suggest.hidden = true;
  el.hint.textContent = "";
  el["guess-submit"].classList.remove("ready");

  if (correct) {
    finishGame("win");
  } else if (state.rounds >= RULES.MAX_ROUNDS) {
    finishGame("rounds");
  } else {
    renderAll();
    el["guess-input"].focus();
  }
}

function useHint() {
  if (state.over) return;
  if (state.hintsLeft <= 0) {
    el.hint.textContent = S().hintNoLeft;
    return;
  }
  // 排除：已通过提示揭示的属性 + 已通过猜测猜中的属性（绿框）
  const known = GL.knownFieldsFromHistory(
    state.history.map((id) => GL.compareAll(state.players[id], state.target))
  );
  const excluded = [...state.revealedHints, ...known];
  const field = GL.pickHintField(excluded);
  if (!field) {
    el.hint.textContent = S().hintAllRevealed;
    return;
  }
  state.hintsLeft -= 1;
  state.revealedHints.push(field);
  el.hint.textContent = S().hintGained(GL.hintText(state.target, field, state.lang));
  renderAll();
}

/* ---------------- 事件 ---------------- */

el["guess-input"].addEventListener("input", () => {
  el["guess-input"].dataset.chosenId = "";
  el["guess-submit"].classList.remove("ready");
  renderSuggestions(el["guess-input"].value);
});

el["guess-input"].addEventListener("focus", () => {
  if (el["guess-input"].value.trim()) renderSuggestions(el["guess-input"].value);
});

el["guess-input"].addEventListener("blur", () => {
  window.setTimeout(() => {
    el.suggest.hidden = true;
  }, 120);
});

el["guess-input"].addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return; // 中文输入法选词中
  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveActive(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    moveActive(-1);
  } else if (e.key === "Escape") {
    el.suggest.hidden = true;
    state.activeIndex = -1;
  } else if (e.key === "Enter" && !el.suggest.hidden && state.activeIndex >= 0) {
    e.preventDefault();
    chooseSuggestion(state.activeIndex);
  }
});

el["guess-form"].addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.over) return;
  const chosenId = el["guess-input"].dataset.chosenId;
  if (chosenId !== undefined && chosenId !== "") {
    submitGuess(Number(chosenId));
    return;
  }
  // 允许直接输入完整姓名后回车
  const typed = el["guess-input"].value.trim();
  if (!typed) {
    el.hint.textContent = S().enterName;
    return;
  }
  const exact = state.players.find(
    (p) => t(p.name) === typed || p.name.zh === typed || p.name.en.toLowerCase() === typed.toLowerCase()
  );
  if (!exact) {
    el.hint.textContent = S().pickFromList;
    return;
  }
  submitGuess(exact.id);
});

el["new-game"].addEventListener("click", () => resetBoard(true));
el.reveal.addEventListener("click", () => {
  if (!state.over) finishGame("reveal");
});
el["hint-btn"].addEventListener("click", useHint);

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => setLang(btn.dataset.lang));
});

/* ---------------- 启动 ---------------- */

async function boot() {
  state.lang = loadLang();
  applyI18n();

  try {
    const [resZh, resEn] = await Promise.all([
      fetch(CSV_ZH, { cache: "no-store" }),
      fetch(CSV_EN, { cache: "no-store" }),
    ]);
    if (!resZh.ok) throw new Error(`players.csv HTTP ${resZh.status}`);
    if (!resEn.ok) throw new Error(`players-en.csv HTTP ${resEn.status}`);

    const [textZh, textEn] = await Promise.all([resZh.text(), resEn.text()]);
    const zhRecords = GL.rowsToRecords(GL.parseCSV(textZh), "球员");
    const enRecords = GL.rowsToRecords(GL.parseCSV(textEn), "Player");
    state.players = GL.buildBilingualPlayers(zhRecords, enRecords);
    if (!state.players.length) throw new Error("球员数据为空");

    const audit = GL.auditTables(state.players);
    if (audit.club.length || audit.nation.length || audit.position.length) {
      console.warn("[猜球员] 参考数据缺失，相关判定会退化为「不加颜色」：", audit);
    }

    el.loading.hidden = true;
    state.stats.plays = Math.max(state.stats.plays, 1);
    saveStats();
    applyI18n();
    resetBoard(false);
  } catch (err) {
    el.loading.hidden = true;
    el.fatal.hidden = false;
    el.fatal.textContent = S().fatalFetch(err.message);
  }
}

boot();
