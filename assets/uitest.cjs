/* 界面流程测试（不参与页面运行）：node assets/uitest.cjs
 * 用极简 DOM 桩加载 index.html 的 id 结构，真实跑一遍 app.js 的完整流程：
 * 开局 → 模糊搜索 → 选人 → 提交 → 提示 → 13 回合上限 → 切换英文 → 猜中。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`✓ ${label} → ${JSON.stringify(actual)}`);
  else {
    failed += 1;
    console.log(`✗ ${label}\n    得到 ${JSON.stringify(actual)}\n    期望 ${JSON.stringify(expected)}`);
  }
}

/* ---------------- 极简 DOM 桩 ---------------- */
class FakeEl {
  constructor(tag, id) {
    this.tagName = tag;
    this.id = id || "";
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this._text = "";
    this._html = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.placeholder = "";
    this.title = "";
    this.className = "";
    const self = this;
    this.classList = {
      add(c) { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.add(c); self.className = [...s].join(" "); },
      remove(c) { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.delete(c); self.className = [...s].join(" "); },
      contains(c) { return self.className.split(/\s+/).includes(c); },
      toggle(c, force) {
        const on = force === undefined ? !this.contains(c) : Boolean(force);
        if (on) this.add(c); else this.remove(c);
        return on;
      },
    };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; this._html = ""; }
  /** 递归文本（等价于浏览器的 textContent：自身文本 + 子孙文本） */
  get text() {
    const own = this._text || "";
    const kids = this.children.map((c) => (typeof c === "string" ? c : c.text)).join("");
    return own + kids;
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; this._text = ""; }
  _pushAll(nodes, unshift) {
    const flat = [];
    nodes.forEach((n) => {
      // 浏览器里 append(fragment) 会把 fragment 的子节点搬进来
      if (n instanceof FakeEl && n.tagName === "#fragment") flat.push(...n.children);
      else flat.push(n);
    });
    if (unshift) this.children.unshift(...flat);
    else this.children.push(...flat);
  }
  append(...nodes) { this._pushAll(nodes, false); }
  prepend(...nodes) { this._pushAll(nodes, true); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  focus() {}
  dispatch(type, evt) {
    const e = Object.assign({ preventDefault() {}, isComposing: false, keyCode: 0 }, evt);
    (this.listeners[type] || []).forEach((fn) => fn(e));
    return e;
  }
  /* 递归收集自身与子孙 */
  all() { return [this, ...this.children.flatMap((c) => (c instanceof FakeEl ? c.all() : []))]; }
  countByClass(cls) { return this.all().filter((n) => n.className && n.className.split(/\s+/).includes(cls)).length; }
}

const ids = [...new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]))];
const registry = new Map(
  ids.map((id) => {
    const node = new FakeEl("div", id);
    // 与 index.html 保持一致：带 hidden 属性的元素初始为隐藏
    const tagText = (html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`)) || [""])[0];
    if (/\shidden(\s|>)/.test(tagText)) node.hidden = true;
    return [id, node];
  })
);
const langButtons = ["zh", "en"].map((lang) => {
  const btn = new FakeEl("button");
  btn.dataset.lang = lang;
  btn.className = "lang-btn";
  return btn;
});

const document = {
  documentElement: { lang: "zh-CN" },
  title: "",
  getElementById: (id) => registry.get(id) || null,
  createElement: (tag) => new FakeEl(tag),
  createDocumentFragment: () => new FakeEl("#fragment"),
  querySelectorAll: (sel) => (sel === ".lang-btn" ? langButtons : []),
};

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const files = {
  "database/players.csv": fs.readFileSync(path.join(root, "database", "players.csv"), "utf8"),
  "database/players-en.csv": fs.readFileSync(path.join(root, "database", "players-en.csv"), "utf8"),
};
const fetchStub = async (url) => {
  const key = String(url);
  if (!(key in files)) return { ok: false, status: 404, text: async () => "" };
  return { ok: true, status: 200, text: async () => files[key] };
};

const sandbox = {
  document,
  localStorage,
  fetch: fetchStub,
  console,
  setTimeout,
  URL,
  URLSearchParams,
  Math: Object.create(Math),
  location: { href: "http://localhost:8000/", search: "" },
  history: { replaceState() {} },
};
sandbox.Math.random = () => 0; // 固定随机源：每局目标都是名单第一位
sandbox.window = sandbox; // 浏览器里 window === globalThis
vm.createContext(sandbox);

for (const file of ["data-tables.js", "i18n.js", "game-logic.js", "app.js"]) {
  const code = fs.readFileSync(path.join(root, "assets", file), "utf8");
  vm.runInContext(code, sandbox, { filename: file });
}

const el = (id) => registry.get(id);
const flush = () => new Promise((r) => setTimeout(r, 60));

/* ---------------- 断言 ---------------- */
(async () => {
  await flush();

  const players = sandbox.GuessLogic.buildBilingualPlayers(
    sandbox.GuessLogic.rowsToRecords(sandbox.GuessLogic.parseCSV(files["database/players.csv"]), "球员"),
    sandbox.GuessLogic.rowsToRecords(sandbox.GuessLogic.parseCSV(files["database/players-en.csv"]), "Player")
  );
  const target = players[0]; // Math.random()=0 → 第一名球员
  const messi = players.find((p) => p.name.en === "Lionel Messi");

  console.log("=== 启动 ===");
  check("index.html 的 id 全部被 app.js 识别（无 null 元素）", [...registry.values()].every((e) => e instanceof FakeEl), true);
  check("数据加载完成（loading 隐藏、无致命错误）", [el("loading").hidden, el("fatal").hidden], [true, true]);
  check("标语显示球员总数", el("tagline").textContent.includes(String(players.length)), true);
  check("战绩：首局场次为 1", el("stat-plays").textContent, "1");
  check("回合计数初始为未开始", el("counter").textContent, "还没有猜过");
  check("提示按钮初始为 3 次", el("hint-btn").textContent, "获取提示（3）");

  console.log("\n=== 模糊搜索 ===");
  el("guess-input").value = "梅西";
  el("guess-input").dispatch("input");
  check("候选框展开", el("suggest").hidden, false);
  check("候选数量（梅西 / 梅西亚斯都含「梅西」）", el("suggest").children.length, 2);
  check("首条候选为里奥·梅西", el("suggest").children[0].children[0].text, "里奥·梅西");
  check("候选附注含位置与俱乐部", el("suggest").children[0].children[1].text.includes("右边锋"), true);
  check(
    "命中片段被 mark 高亮",
    el("suggest").children[0].children[0].children.some((c) => c instanceof FakeEl && c.tagName === "mark"),
    true
  );

  el("suggest").children[0].dispatch("pointerdown");
  check("点选后输入框填入姓名", el("guess-input").value, "里奥·梅西");
  check("点选后记录候选 id", el("guess-input").dataset.chosenId, String(messi.id));

  console.log("\n=== 提交猜测（猜错）===");
  el("guess-form").dispatch("submit");
  check("历史行数", el("guess-rows").children.length, 1);
  const row = el("guess-rows").children[0];
  check("每行 7 个格子（姓名 + 6 项属性，无背号）", row.children.length, 7);
  check("回合计数已更新", el("counter").textContent, "第 1 / 13 回合");
  check("姓名列固定在首列", row.children[0].textContent, "里奥·梅西");
  check("输入框已清空", el("guess-input").value, "");
  check("空提示已隐藏", el("empty-hint").hidden, true);

  // 第二次猜测：与答案同身高 / 同大洲 / 同联赛，用来验证绿、黄、无色三种呈现
  el("guess-input").dataset.chosenId = "";
  el("guess-input").value = "亚历山德罗·巴斯托尼";
  el("guess-form").dispatch("submit");
  const row2 = el("guess-rows").children[0]; // 最新一行在最上面
  check("新猜测插到最上面", row2.children[0].textContent, "亚历山德罗·巴斯托尼");
  check("第二行仍为 7 格", row2.children.length, 7);
  check("出现绿框（身高同为 190cm）", row2.countByClass("cell-match") > 0, true);
  check("出现黄框（同联赛 / 同大洲）", row2.countByClass("cell-close") > 0, true);
  check("出现无色格（惯用脚不同）", row2.countByClass("cell-none") > 0, true);
  check("两行合计 14 格", el("guess-rows").children.reduce((n, r) => n + r.children.length, 0), 14);

  console.log("\n=== 提示（3 次上限，且不重复）===");
  el("hint-btn").dispatch("click");
  el("hint-btn").dispatch("click");
  el("hint-btn").dispatch("click");
  const chips = el("hint-chips").children.map((c) => c.textContent);
  check("提示条数", chips.length, 3);
  check("三条提示互不相同", new Set(chips).size, 3);
  check("提示按钮已禁用", el("hint-btn").disabled, true);
  check("按钮文案显示 0 次", el("hint-btn").textContent, "获取提示（0）");
  el("hint-btn").dispatch("click");
  check("用完后提示次数提示", el("hint-btn").disabled, true);

  console.log("\n=== 切换英文 ===");
  langButtons[1].dispatch("click");
  check("html lang", document.documentElement.lang, "en");
  check("表头英文", [el("th-player").textContent, el("th-type").textContent], ["Player", "Status"]);
  check("按钮英文", [el("guess-submit").textContent, el("reveal").textContent, el("new-game").textContent], ["Guess", "Reveal", "New game"]);
  check("回合文案英文", el("counter").textContent, "Guess 2 of 13");
  check("历史行以英文重绘（最新一行）", el("guess-rows").children[0].children[0].textContent, "Alessandro Bastoni");
  check("历史行以英文重绘（较早一行）", el("guess-rows").children[1].children[0].textContent, "Lionel Messi");
  check("提示 chips 英文重绘（用半角冒号）", el("hint-chips").children[0].textContent.includes("："), false);
  check("提示 chips 仍为 3 条", el("hint-chips").children.length, 3);
  check("标题英文", el("title-a").textContent, "Guess the");
  check("页面 title", document.title, "Guess the Footballer · 26-27");

  console.log("\n=== 13 回合上限 ===");
  el("new-game").dispatch("click"); // 重新开局，目标仍是 players[0]
  check("新局回合归零", el("counter").textContent, "No guesses yet");
  check("提示次数重置", el("hint-btn").textContent, "Get a hint (3)");
  for (let i = 1; i <= 13; i += 1) {
    const p = players[i];
    el("guess-input").dataset.chosenId = "";
    el("guess-input").value = p.name.en;
    el("guess-form").dispatch("submit");
  }
  check("13 回合后结束", el("guess-input").disabled, true);
  check("回合计数停在 13", el("counter").textContent, "Guess 13 of 13");
  check("显示失败横幅", [el("banner").hidden, el("banner").className.includes("banner-lose")], [false, true]);
  check("失败横幅包含答案姓名", el("banner").children[0].textContent.includes(target.name.en), true);

  console.log("\n=== 猜中 ===");
  el("new-game").dispatch("click");
  el("guess-input").dataset.chosenId = "";
  el("guess-input").value = target.name.en;
  el("guess-form").dispatch("submit");
  check("显示胜利横幅", [el("banner").hidden, el("banner").className.includes("banner-win")], [false, true]);
  check("胜利横幅包含答案姓名", el("banner").children[0].textContent.includes(target.name.en), true);
  check("猜中数 +1", el("stat-wins").textContent, "1");
  check("最少回合记录为 1", el("stat-best").textContent, "1");
  check("结束后输入被禁用", [el("guess-input").disabled, el("hint-btn").disabled], [true, true]);

  console.log("\n=== 重复猜测拦截 ===");
  el("new-game").dispatch("click");
  el("guess-input").dataset.chosenId = "";
  el("guess-input").value = players[5].name.en;
  el("guess-form").dispatch("submit");
  el("guess-input").dataset.chosenId = "";
  el("guess-input").value = players[5].name.en;
  el("guess-form").dispatch("submit");
  check("没有重复插入历史行", el("guess-rows").children.length, 1);
  check("给出重复提示", el("hint").textContent.includes(players[5].name.en), true);

  console.log("\n=== 提示不得重复已猜出的信息 ===");
  langButtons[0].dispatch("click"); // 切回中文
  sandbox.Math.random = () => 0; // 新局目标固定为 players[0]
  el("new-game").dispatch("click");
  const seedorf = players.find((p) => p.name.en === "Clarence Seedorf");
  check("所选陪猜球员与答案同国籍同类型同惯用脚", [
    seedorf.nation.zh === target.nation.zh,
    seedorf.type.zh === target.type.zh,
    seedorf.foot.zh === target.foot.zh,
  ], [true, true, true]);
  el("guess-input").dataset.chosenId = "";
  el("guess-input").value = seedorf.name.zh;
  el("guess-form").dispatch("submit");
  const greenFields = ["nation", "foot", "type"].every((f) => {
    const cells = el("guess-rows").children[0].children;
    const idx = ["name", "height", "nation", "club", "foot", "position", "type"].indexOf(f);
    return cells[idx].className.includes("cell-match");
  });
  check("该次猜测确实让国籍/惯用脚/类型变绿", greenFields, true);

  sandbox.Math.random = () => 0.42; // 固定提示抽取顺序
  el("hint-btn").dispatch("click");
  el("hint-btn").dispatch("click");
  el("hint-btn").dispatch("click");
  const hintTexts = el("hint-chips").children.map((c) => c.textContent);
  check("仍然拿到 3 条提示", hintTexts.length, 3);
  check("提示里不含已猜中的国籍", hintTexts.some((x) => x.includes("国籍")), false);
  check("提示里不含已猜中的惯用脚", hintTexts.some((x) => x.includes("惯用脚")), false);
  check("提示里不含已猜中的类型", hintTexts.some((x) => x.includes("类型")), false);
  check("提示里不含国籍的具体值", hintTexts.some((x) => x.includes(target.nation.zh)), false);
  check("提示仍揭示答案的真实值", hintTexts.some((x) => x.includes(`${target.height}cm`)), true);
  check("三条提示互不重复", new Set(hintTexts).size, 3);
  console.log("    实际提示：", hintTexts.join(" / "));

  console.log(`\n${failed === 0 ? "界面流程全部通过 ✅" : failed + " 项未通过 ❌"}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error("测试异常：", err);
  process.exit(1);
});
