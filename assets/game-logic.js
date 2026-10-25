/* ============================================================
 * 猜球员 · 纯逻辑（无 DOM 依赖，可在浏览器与 Node 中共用）
 * 依赖 data-tables.js 提供的 LEAGUE_OF_CLUB / CONTINENT_OF_NATION / POSITION_GROUP
 * 判定与展示均以「中文标准值」为内部键，英文版通过中英对照行桥接。
 * ============================================================ */
(function (root, factory) {
  const tables =
    typeof LEAGUE_OF_CLUB !== "undefined"
      ? { LEAGUE_OF_CLUB, CONTINENT_OF_NATION, POSITION_GROUP }
      : require("./data-tables.js");
  const api = factory(tables);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.GuessLogic = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (tables) {
  "use strict";

  const { LEAGUE_OF_CLUB, CONTINENT_OF_NATION, POSITION_GROUP } = tables;

  /** 游戏常量 */
  const RULES = {
    MAX_ROUNDS: 13, // 每局最多 13 回合
    HINTS_PER_ROUND: 3, // 每局最多用 3 次提示
    HEIGHT_TOLERANCE: 3, // 身高 ±3cm → 黄（背号已不参与判定）
  };

  /** 判定结果（内部键）→ 多语言标签 */
  const LABELS = {
    联赛: {
      "英超": { zh: "英超", en: "Premier League" },
      "西甲": { zh: "西甲", en: "LaLiga" },
      "意甲": { zh: "意甲", en: "Serie A" },
      "德甲": { zh: "德甲", en: "Bundesliga" },
      "法甲": { zh: "法甲", en: "Ligue 1" },
      "葡超": { zh: "葡超", en: "Primeira Liga" },
      "荷甲": { zh: "荷甲", en: "Eredivisie" },
      "土超": { zh: "土超", en: "Super Lig" },
      "沙特联": { zh: "沙特联", en: "Saudi Pro League" },
      "美职联": { zh: "美职联", en: "MLS" },
      "巴甲": { zh: "巴甲", en: "Brasileirao" },
      "阿甲": { zh: "阿甲", en: "Argentine Primera" },
      "希腊超": { zh: "希腊超", en: "Super League Greece" },
      "比甲": { zh: "比甲", en: "Belgian Pro League" },
      "卡塔尔联": { zh: "卡塔尔联", en: "Qatar Stars League" },
      "阿联酋联": { zh: "阿联酋联", en: "UAE Pro League" },
      "中超": { zh: "中超", en: "Chinese Super League" },
      "无俱乐部": { zh: "自由球员", en: "free agent" },
      "未知联赛": { zh: "未知联赛", en: "unknown league" },
    },
    大洲: {
      "欧洲": { zh: "欧洲", en: "Europe" },
      "南美洲": { zh: "南美洲", en: "South America" },
      "北美洲": { zh: "北美洲", en: "North America" },
      "非洲": { zh: "非洲", en: "Africa" },
      "亚洲": { zh: "亚洲", en: "Asia" },
      "大洋洲": { zh: "大洋洲", en: "Oceania" },
      "未知大洲": { zh: "未知大洲", en: "unknown continent" },
    },
    分区: {
      "前场": { zh: "前场", en: "attack" },
      "中场": { zh: "中场", en: "midfield" },
      "后场": { zh: "后场", en: "defence" },
      "未知": { zh: "未知", en: "unknown" },
    },
  };

  /* ---------- 基础工具 ---------- */

  /** 解析带引号的 CSV 文本 → 二维数组 */
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }
    if (field !== "" || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  }

  /** CSV → 行数组（去掉表头，含空值过滤） */
  function rowsToRecords(rows, expectedHeader) {
    const list = rows.slice();
    const header = list.shift();
    if (!header || header[0] !== expectedHeader) {
      throw new Error(`表头不符合预期：期望「${expectedHeader}」`);
    }
    return list
      .map((r) => ({
        name: String(r[0] || "").trim(),
        position: String(r[1] || "").trim(),
        type: String(r[2] || "").trim(),
        number: Number(String(r[3] || "").trim()),
        club: String(r[4] || "").trim(),
        nation: String(r[5] || "").trim(),
        height: Number(String(r[6] || "").trim()),
        foot: String(r[7] || "").trim(),
      }))
      .filter((p) => p.name && p.position && Number.isFinite(p.number) && Number.isFinite(p.height));
  }

  /**
   * 把中英两版名单合并成双语球员对象（按行对齐）。
   * 内部判定始终使用中文值，展示时按语言取值。
   */
  function buildBilingualPlayers(zhRecords, enRecords) {
    if (zhRecords.length !== enRecords.length) {
      throw new Error(
        `中英文名单行数不一致（中文 ${zhRecords.length} 行 / 英文 ${enRecords.length} 行），无法对齐`
      );
    }
    return zhRecords.map((zh, i) => {
      const en = enRecords[i];
      if (zh.number !== en.number || zh.height !== en.height) {
        throw new Error(
          `中英文名单第 ${i + 1} 行数据不匹配（${zh.name} / ${en.name}），请先同步两份 CSV`
        );
      }
      return {
        id: i,
        name: { zh: zh.name, en: en.name },
        position: { zh: zh.position, en: en.position },
        type: { zh: zh.type, en: en.type },
        number: zh.number,
        club: { zh: zh.club, en: en.club },
        nation: { zh: zh.nation, en: en.nation },
        height: zh.height,
        foot: { zh: zh.foot, en: en.foot },
      };
    });
  }

  /** 归一化文本：去空格、间隔号、标点，转小写，便于模糊匹配 */
  function normalize(str) {
    return String(str)
      .toLowerCase()
      .replace(/[·・\s'’.,\-()（）]/g, "");
  }

  const leagueOf = (club) => LEAGUE_OF_CLUB[club] || "未知联赛";
  const continentOf = (nation) => CONTINENT_OF_NATION[nation] || "未知大洲";
  const groupOf = (position) => POSITION_GROUP[position] || "未知";

  /** 内部键 → 指定语言的可读文本 */
  function label(kind, key, lang) {
    const entry = LABELS[kind] && LABELS[kind][key];
    if (!entry) return key;
    return entry[lang] || entry.zh;
  }

  /* ---------- 判定规则 ---------- */

  /**
   * 数值比较：完全一致 → match；差值在容差内 → close；否则 none
   * arrow：答案比所猜的更大（up）/ 更小（down）
   */
  function compareNumeric(guess, target, tolerance) {
    const g = Number(guess);
    const t = Number(target);
    if (!Number.isFinite(g) || !Number.isFinite(t)) return { cls: "none", arrow: "" };
    if (g === t) return { cls: "match", arrow: "" };
    return {
      cls: Math.abs(g - t) <= tolerance ? "close" : "none",
      arrow: t > g ? "up" : "down",
      diff: t - g,
    };
  }

  function compareNation(guess, target) {
    if (guess === target) return { cls: "match", note: guess };
    const gc = continentOf(guess);
    const tc = continentOf(target);
    if (gc === tc && gc !== "未知大洲") return { cls: "close", note: gc };
    return { cls: "none", note: gc };
  }

  function compareClub(guess, target) {
    if (guess === target) return { cls: "match", note: guess };
    const gl = leagueOf(guess);
    const tl = leagueOf(target);
    if (gl === tl && gl !== "未知联赛" && gl !== "无俱乐部") return { cls: "close", note: gl };
    return { cls: "none", note: gl };
  }

  function compareFoot(guess, target) {
    return guess === target ? { cls: "match", note: guess } : { cls: "none", note: guess };
  }

  function comparePosition(guess, target) {
    if (guess === target) return { cls: "match", note: guess };
    const gg = groupOf(guess);
    const tg = groupOf(target);
    if (gg === tg && gg !== "未知") return { cls: "close", note: gg };
    return { cls: "none", note: guess };
  }

  /** 现役 / 历史：完全一致为绿，否则不上色 */
  function compareType(guess, target) {
    return guess === target ? { cls: "match", note: guess } : { cls: "none", note: guess };
  }

  /** 一行完整的对比结果（内部键）。背号已不参与猜测。 */
  function compareAll(guess, target) {
    return {
      name: { cls: guess.name.zh === target.name.zh ? "match" : "none", note: "" },
      height: compareNumeric(guess.height, target.height, RULES.HEIGHT_TOLERANCE),
      nation: compareNation(guess.nation.zh, target.nation.zh),
      club: compareClub(guess.club.zh, target.club.zh),
      foot: compareFoot(guess.foot.zh, target.foot.zh),
      position: comparePosition(guess.position.zh, target.position.zh),
      type: compareType(guess.type.zh, target.type.zh),
    };
  }

  /* ---------- 模糊搜索（两种语言都能命中） ---------- */

  function searchPlayers(players, query, limit) {
    const max = limit || 8;
    const qRaw = query.trim();
    const q = normalize(qRaw);
    const qLower = qRaw.toLowerCase();
    if (!q) return [];

    const scored = [];
    for (const p of players) {
      let best = null;
      for (const lang of ["zh", "en"]) {
        const raw = p.name[lang];
        const name = normalize(raw);
        if (!name.includes(q)) continue;

        let score = 3; // 只在中段命中
        if (name === q) {
          score = 0;
        } else if (raw.toLowerCase().startsWith(qLower)) {
          // 「罗德里」应优先命中「罗德里·埃尔南德斯」，而不是「罗德里戈」
          const boundary = raw.charAt(qRaw.length);
          score = boundary === "" || ["·", "・", " "].includes(boundary) ? 1 : 2;
        } else if (name.startsWith(q)) {
          score = 2;
        }
        if (best === null || score < best) best = score;
      }
      if (best !== null) scored.push({ player: p, score: best, len: normalize(p.name.zh).length });
    }
    scored.sort(
      (a, b) =>
        a.score - b.score || a.len - b.len || a.player.name.zh.localeCompare(b.player.name.zh, "zh")
    );
    return scored.slice(0, max).map((s) => s.player);
  }

  /* ---------- 提示（随机揭示一项尚未已知的答案属性） ---------- */

  const HINT_FIELDS = ["height", "nation", "club", "foot", "position", "type"];

  /**
   * 从历史猜测里统计「已经猜出来」的属性（出现过绿框的项）。
   * 这些属性玩家已经知道，提示不应再重复。
   * @param {object[]} comparisons compareAll() 的结果数组
   */
  function knownFieldsFromHistory(comparisons) {
    const known = new Set();
    (comparisons || []).forEach((cmp) => {
      if (!cmp) return;
      HINT_FIELDS.forEach((field) => {
        if (cmp[field] && cmp[field].cls === "match") known.add(field);
      });
    });
    return HINT_FIELDS.filter((f) => known.has(f));
  }

  /**
   * 从未知属性里随机取一项提示。
   * @param {string[]} excluded 需排除的字段（已揭示的 + 已猜出的）
   * @param {() => number} [rand] 随机源，便于测试
   * @returns {string|null} 无可用字段时返回 null
   */
  function pickHintField(excluded, rand) {
    const random = rand || Math.random;
    const skip = Array.isArray(excluded) ? excluded : [];
    const pool = HINT_FIELDS.filter((f) => !skip.includes(f));
    if (!pool.length) return null;
    return pool[Math.floor(random() * pool.length)];
  }

  /** 把提示字段渲染成文字 */
  function hintText(player, field, lang) {
    const en = lang === "en";
    const sep = en ? ": " : "：";
    const unit = (v) => (en ? v : v);
    switch (field) {
      case "height":
        return `${en ? "Height" : "身高"}${sep}${player.height}${en ? " cm" : "cm"}`;
      case "nation":
        return `${en ? "Nationality" : "国籍"}${sep}${player.nation[lang]}`;
      case "club":
        return `${en ? "Club" : "俱乐部"}${sep}${player.club[lang]}`;
      case "foot":
        return `${en ? "Preferred foot" : "惯用脚"}${sep}${en ? player.foot.en : player.foot.zh + "脚"}`;
      case "position":
        return `${en ? "Position" : "位置"}${sep}${player.position[lang]}`;
      case "type":
        return `${en ? "Status" : "类型"}${sep}${player.type[lang]}`;
      default:
        return unit("");
    }
  }

  /* ---------- 数据完整性检查 ---------- */

  function auditTables(players) {
    const problems = { club: [], nation: [], position: [] };
    for (const p of players) {
      if (!LEAGUE_OF_CLUB[p.club.zh]) problems.club.push(p.club.zh);
      if (!CONTINENT_OF_NATION[p.nation.zh]) problems.nation.push(p.nation.zh);
      if (!POSITION_GROUP[p.position.zh]) problems.position.push(p.position.zh);
    }
    const uniq = (arr) => [...new Set(arr)];
    return {
      club: uniq(problems.club),
      nation: uniq(problems.nation),
      position: uniq(problems.position),
    };
  }

  return {
    RULES,
    LABELS,
    HINT_FIELDS,
    parseCSV,
    rowsToRecords,
    buildBilingualPlayers,
    normalize,
    leagueOf,
    continentOf,
    groupOf,
    label,
    compareNumeric,
    compareNation,
    compareClub,
    compareFoot,
    comparePosition,
    compareType,
    compareAll,
    knownFieldsFromHistory,
    searchPlayers,
    pickHintField,
    hintText,
    auditTables,
  };
});
