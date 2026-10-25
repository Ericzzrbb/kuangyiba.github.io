/* 本地校验脚本（不参与页面运行）：node assets/selftest.cjs */
const fs = require("fs");
const path = require("path");
const GL = require("./game-logic.js");
const { STRINGS } = require("./i18n.js");

const root = path.join(__dirname, "..");
const zhCsv = fs.readFileSync(path.join(root, "database", "players.csv"), "utf8");
const enCsv = fs.readFileSync(path.join(root, "database", "players-en.csv"), "utf8");

const zhRecords = GL.rowsToRecords(GL.parseCSV(zhCsv), "球员");
const enRecords = GL.rowsToRecords(GL.parseCSV(enCsv), "Player");
const players = GL.buildBilingualPlayers(zhRecords, enRecords);

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`✓ ${label} → ${JSON.stringify(actual)}`);
  } else {
    failed += 1;
    console.log(`✗ ${label}\n    得到 ${JSON.stringify(actual)}\n    期望 ${JSON.stringify(expected)}`);
  }
}
const cls = (r) => r.cls;
const find = (en) => players.find((p) => p.name.en === en);

console.log("=== 数据与中英对齐 ===");
check("球员总数（与 CSV 行数一致）", players.length, zhRecords.length);
check("球员数量合理（> 700）", players.length > 700, true);
check("中文行数 == 英文行数", zhRecords.length === enRecords.length, true);
check("俱乐部数", new Set(players.map((p) => p.club.zh)).size, 99);
check("国籍数", new Set(players.map((p) => p.nation.zh)).size, 67);
check("位置数", new Set(players.map((p) => p.position.zh)).size, 13);
const audit = GL.auditTables(players);
check("未收录联赛的俱乐部", audit.club, []);
check("未收录大洲的国籍", audit.nation, []);
check("未收录分区的位置", audit.position, []);
check("背号/身高合理", players.every((p) => p.number >= 1 && p.number <= 99 && p.height > 150 && p.height < 230), true);
check("英文名单确实为英文（无中文）", enRecords.every((p) => !/[\u4e00-\u9fff]/.test(p.name + p.club + p.nation + p.position + p.type)), true);

console.log("\n=== 规则常量 ===");
check("回合上限", GL.RULES.MAX_ROUNDS, 13);
check("每局提示次数", GL.RULES.HINTS_PER_ROUND, 3);
check("身高容差", GL.RULES.HEIGHT_TOLERANCE, 3);

console.log("\n=== 身高 ±3（背号已不参与判定）===");
check("身高相同", cls(GL.compareNumeric(180, 180, 3)), "match");
check("身高差 3", cls(GL.compareNumeric(180, 183, 3)), "close");
check("身高差 4", cls(GL.compareNumeric(180, 184, 3)), "none");
check("答案更高 → ▲", GL.compareNumeric(170, 190, 3).arrow, "up");
check("答案更矮 → ▼", GL.compareNumeric(190, 170, 3).arrow, "down");
check("背号容差已移除", "NUMBER_TOLERANCE" in GL.RULES, false);

console.log("\n=== 国籍：同大洲 ===");
check("巴西 vs 阿根廷", cls(GL.compareNation("巴西", "阿根廷")), "close");
check("巴西 vs 西班牙", cls(GL.compareNation("巴西", "西班牙")), "none");
check("日本 vs 韩国", cls(GL.compareNation("日本", "韩国")), "close");
check("法国 vs 法国", cls(GL.compareNation("法国", "法国")), "match");

console.log("\n=== 俱乐部：同联赛 ===");
check("巴萨 vs 皇马", cls(GL.compareClub("巴塞罗那", "皇家马德里")), "close");
check("巴萨 vs 本菲卡", cls(GL.compareClub("巴塞罗那", "本菲卡")), "none");
check("同俱乐部", cls(GL.compareClub("国际米兰", "国际米兰")), "match");
check("自由球员 vs 自由球员", cls(GL.compareClub("自由球员", "自由球员")), "match");
check("自由球员 vs 阿森纳", cls(GL.compareClub("自由球员", "阿森纳")), "none");

console.log("\n=== 位置：前/中/后场 ===");
check("中锋 vs 右边锋", cls(GL.comparePosition("中锋", "右边锋")), "close");
check("中锋 vs 门将", cls(GL.comparePosition("中锋", "门将")), "none");
check("后腰 vs 前腰", cls(GL.comparePosition("后腰", "前腰")), "close");
check("中后卫 vs 左后卫", cls(GL.comparePosition("中后卫", "左后卫")), "close");
check("同一位置", cls(GL.comparePosition("门将", "门将")), "match");

console.log("\n=== 惯用脚 ===");
check("同为左脚", cls(GL.compareFoot("左", "左")), "match");
check("一左一右", cls(GL.compareFoot("左", "右")), "none");

console.log("\n=== 类型（现役 / 历史）：只认完全一致 ===");
check("同为现役 → 绿", cls(GL.compareType("现役", "现役")), "match");
check("同为历史 → 绿", cls(GL.compareType("历史", "历史")), "match");
check("现役 vs 历史 → 不上色", cls(GL.compareType("现役", "历史")), "none");

console.log("\n=== compareAll 包含 7 项（名字 + 6 项属性，无背号）===");
const messi = find("Lionel Messi");
const haaland = find("Erling Haaland");
const cmp = GL.compareAll(messi, haaland);
check("字段齐全", Object.keys(cmp).sort(), ["club", "foot", "height", "name", "nation", "position", "type"]);
check("梅西(现役) vs 哈兰德(现役) → 类型绿", cmp.type.cls, "match");
const zico = find("Zico");
check("梅西(现役) vs 济科(历史) → 类型不上色", cls(GL.compareAll(messi, zico).type), "none");
check("梅西 vs 哈兰德：身高差 24 → 无色", cmp.height.cls, "none");

console.log("\n=== 模糊搜索（中文 / 英文都能命中）===");
check("中文「梅西」", GL.searchPlayers(players, "梅西", 8)[0].name.en, "Lionel Messi");
check("英文「messi」", GL.searchPlayers(players, "messi", 8)[0].name.zh, "里奥·梅西");
check(
  "英文「bellingham」命中两位贝林厄姆",
  GL.searchPlayers(players, "bellingham", 8).map((p) => p.name.zh).sort(),
  ["乔布·贝林厄姆", "朱德·贝林厄姆"].sort()
);
check("「罗德里」前缀优先命中罗德里·埃尔南德斯", GL.searchPlayers(players, "罗德里", 8)[0].name.zh, "罗德里·埃尔南德斯");
check("空查询", GL.searchPlayers(players, "  ", 8).length, 0);
check("无匹配", GL.searchPlayers(players, "zzzzzz", 8).length, 0);
check("结果不超过 8 条", GL.searchPlayers(players, "a", 8).length <= 8, true);

console.log("\n=== 提示：随机揭示一项，且不重复 ===");
const pool = GL.HINT_FIELDS;
check("提示字段覆盖 6 项（不含背号）", pool.length, 6);
const seq = [0.0, 0.3, 0.66];
const revealed = [];
seq.forEach((r) => {
  const f = GL.pickHintField(revealed, () => r);
  if (f) revealed.push(f);
});
check("揭示三项后互不重复", new Set(revealed).size, revealed.length);
check("揭示三项后仍有未揭示项", GL.pickHintField(revealed, () => 0.5) !== null, true);
check("全部揭示后返回 null", GL.pickHintField([...pool], () => 0.5), null);

console.log("\n=== 提示不得是已猜出的信息（绿框字段要被排除）===");
const seedorf = find("Clarence Seedorf");
const rijk = players[0]; // 里杰卡尔德：荷兰 / 历史 / 右脚
const known = GL.knownFieldsFromHistory([GL.compareAll(seedorf, rijk)]);
check("历史里出现过的绿框字段被识别", known, ["nation", "foot", "type"]);
check("未知的历史为空", GL.knownFieldsFromHistory([]), []);
check("多项历史合并去重", GL.knownFieldsFromHistory([
  GL.compareAll(seedorf, messi),
  GL.compareAll(messi, messi),
]).length, 6);
for (let i = 0; i < 20; i += 1) {
  const f = GL.pickHintField(known, () => i / 20);
  if (f !== null && known.includes(f)) {
    check("提示抽到了已猜出的字段", f, "不应出现");
    break;
  }
}
check("已猜出的 3 项全部排除后仍可提示", [
  GL.pickHintField(known, () => 0) !== null,
  ["height", "club", "position"].includes(GL.pickHintField(known, () => 0)),
], [true, true]);
check("已揭示 + 已猜出全排除 → null", GL.pickHintField([...new Set([...known, ...pool])], () => 0.5), null);
check("提示值取自答案而非猜测对象", GL.hintText(messi, "club", "zh"), `俱乐部：${messi.club.zh}`);
check(
  "提示文案（中文身高）",
  GL.hintText(messi, "height", "zh"),
  `身高：${messi.height}cm`
);
check("提示文案不再包含背号字段", GL.HINT_FIELDS.includes("number"), false);
check(
  "提示文案（英文，半角冒号）",
  GL.hintText(messi, "nation", "en"),
  `Nationality: ${messi.nation.en}`
);
check(
  "提示文案（英文身高带单位）",
  GL.hintText(messi, "height", "en"),
  `Height: ${messi.height} cm`
);
check(
  "提示文案（中文惯用脚）",
  GL.hintText(messi, "foot", "zh"),
  `惯用脚：${messi.foot.zh}脚`
);

console.log("\n=== 文案完整性（中英对照，覆盖所有 key）===");
const zhKeys = Object.keys(STRINGS.zh).sort();
const enKeys = Object.keys(STRINGS.en).sort();
check("中英文案 key 一致", enKeys, zhKeys);
check("表格表头数量（无背号）", Object.keys(STRINGS.zh.tableHead).length, 7);
check("规则条目数量", STRINGS.zh.rules.length, STRINGS.en.rules.length);
check("英文规则条目数 ≥ 6", STRINGS.en.rules.length >= 6, true);
check("英文页脚为函数", typeof STRINGS.en.footer, "function");
check("英文统计标签", [STRINGS.en.statPlays, STRINGS.en.statWins, STRINGS.en.statBest], ["Games", "Wins", "Best"]);
check("英文回合文案", STRINGS.en.roundsUsed(3, 13), "Guess 3 of 13");
check("中文回合文案", STRINGS.zh.roundsUsed(3, 13), "第 3 / 13 回合");

console.log("\n=== 联赛/大洲/分区标签有多语言 ===");
check("英超英文", GL.label("联赛", "英超", "en"), "Premier League");
check("南美洲英文", GL.label("大洲", "南美洲", "en"), "South America");
check("前场英文", GL.label("分区", "前场", "en"), "attack");
check("未知 key 原样返回", GL.label("联赛", "不存在", "en"), "不存在");

console.log(`\n${failed === 0 ? "全部通过 ✅" : failed + " 项未通过 ❌"}`);
process.exit(failed === 0 ? 0 : 1);
