# 猜球员 · Guess the Footballer

一个纯静态的「猜球员」网页游戏，数据来自本仓库的 26-27 赛季球员名单（782 名球员 / 99 家俱乐部 / 67 个国籍）。
开一局后系统随机抽取一名球员，你用最多 13 个回合、靠颜色提示逐步逼近答案。**支持中英双语。**

线上地址：<https://kuangyiba.github.io/>
英文版：<https://kuangyiba.github.io/?lang=en>

## 玩法

1. 在输入框输入球员名字（中英文都能搜，输入「梅西」「messi」「罗德里」等片段即可）。
2. 在下方弹出的候选框里点选球员，然后点「确认猜测 / Guess」或按回车。
3. 每一行会显示你猜的球员，并对 **6 项属性** 给出提示：

| 属性 | 绿框（完全一致） | 黄框（接近） | 无色 |
| --- | --- | --- | --- |
| 身高 Height | 身高相同 | 相差 ±3cm 以内 | 其他 |
| 国籍 Nationality | 同一国家 | 同一大洲 | 其他 |
| 俱乐部 Club | 同一俱乐部 | 同一联赛 | 其他 |
| 惯用脚 Foot | 同一只脚 | — | 不同 |
| 位置 Position | 完全同一位置 | 同属前场/中场/后场 | 其他 |
| 类型 Status | 同为现役 / 同为历史 | — | 其他 |

- 前场：中锋、左边锋、右边锋、影锋
- 中场：中前卫、左前卫、右前卫、前腰、后腰
- 后场：左后卫、右后卫、中后卫、门将
- 身高格子上的 ▲ / ▼ 表示「答案比这个大 / 小」。

### 回合与提示

- 每局 **最多 13 个回合**，用完全部回合仍未猜中即失败。
- **获取提示**：每局可用 **3 次**，每次随机揭示答案的一项属性（身高 / 国籍 / 俱乐部 / 惯用脚 / 位置 / 类型）。已揭示过的属性不会重复；**你已经通过猜测猜中（绿框）的属性也不会再提示**，所以提示永远能带来新信息。
- 「看答案」直接结束本局并公布答案，「重新开局」换一名球员。
- 战绩（总场次 / 猜中 / 最少回合）保存在浏览器 localStorage。

## 目录结构

```
index.html              页面结构
assets/style.css        样式
assets/data-tables.js   参考数据：俱乐部→联赛、国籍→大洲、位置→前场/中场/后场
assets/i18n.js          中英文案
assets/game-logic.js    纯逻辑：CSV 解析、中英对照桥接、模糊搜索、判定规则、提示（Node 可复用）
assets/app.js           界面与游戏流程
assets/selftest.cjs    逻辑自检：数据、中英对齐、判定规则、提示、文案
assets/uitest.cjs      界面自检：用 DOM 桩跑完整流程（搜索→猜测→提示→13 回合→切换英文→猜中）
database/players.csv    中文名单（数据源）
database/players-en.csv 英文名单（与中文版逐行对齐）
```

英文版通过中英对照「逐行桥接」实现：判定始终用中文标准值，展示时按当前语言取值，因此两种语言共用同一套规则表。

## 本地运行

浏览器出于安全限制，无法用 `file://` 读取同目录的 CSV，请起一个静态服务器：

```bash
python -m http.server 8000
# 然后访问 http://localhost:8000/ （英文版：http://localhost:8000/?lang=en）
```

## 部署到 GitHub Pages

1. 把改动提交并推送到 `main` 分支：
   ```bash
   git add -A
   git commit -m "add guess-the-player game"
   git push
   ```
2. 仓库 **Settings → Pages** 中，Source 选择 `Deploy from a branch`，分支选 `main`、目录选 `/ (root)`。
3. 稍等一两分钟，访问 `https://<用户名>.github.io/` 即可（本仓库为 <https://kuangyiba.github.io/>）。

页面没有任何构建步骤、没有第三方依赖，`index.html` 在仓库根目录即可直接生效。

## 更新球员数据

直接编辑 `database/players.csv`（UTF-8、各字段带引号），英文版同步修改 `database/players-en.csv`（**两份文件必须逐行对齐**，页面启动时会校验行数与背号/身高，不一致会直接报错提示）。

- 若有**新增俱乐部或国籍**，需要在 `assets/data-tables.js` 里补上所属联赛 / 大洲，否则该项判定会退化成「不显示颜色」（页面控制台会有 warn 提示）。
- 若有**新增联赛**，还要在 `assets/game-logic.js` 的 `LABELS.联赛` 里补上英文名。
- 每次改完跑一次自检：校验数据、中英对齐、全部判定规则、提示与文案：

```bash
node assets/selftest.cjs   # 数据与规则
node assets/uitest.cjs     # 界面流程（搜索/猜测/提示/回合上限/中英切换）
```
