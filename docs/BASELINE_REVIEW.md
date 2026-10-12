# 基座审查报告（BASELINE REVIEW）

- 日期：2026-10-13
- 状态：已完成，结论已执行（earpath-app 已导入本项目）
- 审查人：首席开发 Agent（另由 5 个独立调查子代理并行取证）

## 1. 目的与方法

为"极简、功能完整、可维护、纯静态部署"的练耳 Web 应用选择开源基座，核实 5 个候选仓库的**实际**功能与许可证，区分"真正实现 / 仅文档宣传 / 缺失"。

方法（全部在本机核验，可复现）：

1. 浅克隆（`git clone --depth 30`）到 `./.baseline-review/<name>/`（已 gitignore，仅作证据保留）并读取源码；
2. GitHub API 元数据（stars / license / archived / 时间线）交叉验证；
3. 线上站点抽查（earpath.app、open-ear Vercel 部署等）；
4. 关键结论由主线独立复核（许可证文件原文、功能缺失断言、乐理数据正确性抽样）。
5. 未做：除 open-ear 外未在浏览器实跑各候选 UI；未逐字比对线上版本与最新 commit。

复现命令见第 9 节。

## 2. 检查项定义

功能项：**A** 绝对音准（无参考音辨音名）；**B** 相对音准/调内音级（tonic 上下文 + 音级识别）；**C** 音程听辨；**D** 和弦类型听辨；**E** 和弦转位听辨；**F** 音色切换（至少合成音+钢琴）；**G** 训练统计与本地持久化；**H** 自定义训练范围/题型/音域。

工程项：**I** 纯静态部署可行性；**J** 音频引擎位置与质量；**K** 判分逻辑与乐理正确性；**L** 代码组织（音频/题目/判分/UI 分离）；**M** 测试；**N** 技术栈与依赖量；**O** 许可证。

## 3. 候选逐一审查

### 3.1 abeage1/earpath-app —— ✅ 选型胜出（MIT）

- 身份：public，默认分支 `main`，最近提交 `f5241f5` 2026-06-11，提交总数 10，stars 1，未 archived；线上 https://earpath.app/ 可访问（200）。自身是 abeage1/earpath（冻结 v0.1）的活跃后继，且 README 声明为 earwise 的 successor。
- 许可证：**MIT**。`LICENSE:1` "MIT License"，`LICENSE:3` "Copyright (c) 2026 abeage1"；GitHub API `license.spdx_id = "MIT"`。
- 功能：
  - A ❌ 缺失。7 个模块（`js/curriculum.js:11-183`）中 Pitch 模块仅为"第二音更高/更低/相同"（`curriculum.js:18`；`js/engine.js:47-76`）。`curriculum.js:8` 注释明言上游刻意"不训练绝对音准技巧"。
  - B ✅ `js/engine.js:206-242`（genDegree）：先奏 I–IV–V–I（或小调 i–iv–V–i）终止式建立调性，再出单音（`js/theory.js:126-129` CADENCES）；12 半音级 solfège/数字可切换（`js/theory.js:95-108`；`js/state.js:11`）。
  - C ✅ `js/theory.js:11-40`（12 基本音程 + 复合 P11/P12 等）；升/降/和声三方向（`js/engine.js:80-119`）；13 个关卡（`curriculum.js:40-54`）。
  - D ✅ `js/theory.js:50-72` 共 22 个和弦 voicing（maj/min/dim/aug/sus/6/7/9/11 关）；判分按 id 精确比较（`engine.js:137-144`）。
  - E ⚠️ 部分：仅大三/小三三和弦 1/2 转位（`theory.js:68-71`：`maj_1 [0,3,8]`、`maj_2 [0,5,9]`、`min_1 [0,4,9]`、`min_2 [0,5,8]`，抽样核对乐理正确），关卡 `curriculum.js:74`。无七和弦转位。
  - F ❌ 缺失：唯一音色为三层振荡器（triangle+sine+sine）合成的"piano-ish"音（`js/audio.js:59-91`），无采样、无 Tone.js、无切换 UI；上游 README:85 将 "Sampled instrument timbres" 列为未完成 roadmap（📢 仅宣传-未完成）。
  - G ✅ localStorage（key `earpath-v1`，`js/state.js:5,34-52`）；逐技能正确率+滚动窗口（`state.js:106-154`）；12 周热图、连击、混淆对及对比试听（`js/views.js:188-294`）；JSON 导出/导入（`state.js:246-257`）。
  - H ⚠️ 部分：`freeRoam`（全解锁、任选关卡，`state.js:13`；`views.js:365-366`）；不可自定义音域、题型直选。
- I ✅ 无 package.json / 无构建步骤 / 根目录直部署；含 `.nojekyll`、PWA manifest、service worker（`sw.js`，network-first）。外链仅 Google Fonts（有 system-ui 回退）与 PostHog（可一键禁用）。
- J 引擎独立于 `js/audio.js`：频率 `440·2^((m−69)/12)`（`theory.js:3`，标准十二平均律）；按键跟踪低通 + 防削波压缩器 + bus 淡出（`audio.js:18-55`）；ADSR（attack/decay/sustain/release，此处为 10ms attack + 指数衰减 + 尾音，`audio.js:86-90`）。
- K 判分随题目自带（如 `engine.js:110-117`），数据核对无误；等音（enharmonic）采用固定拼写表（`theory.js:5`：C♯/E♭/F♯/A♭/B♭）。
- L ✅ 优：theory / curriculum / audio / engine / state / session / views / piano / ui 单职责拆分，13 个 ES Module 共约 2371 行 JS（`wc -l js/*.js`），加载入口单一 `<script type="module" src="js/main.js">`（`index.html:32`）。
- M ❌ 无任何测试/框架/CI（无 package.json）。
- N 纯 vanilla JS，**零第三方依赖**，无框架、无构建工具。
- 风险：仓库极新（2026-06 创建）、1 star、提交少且据 git log 元数据多含 AI 协作署名；无测试。**但作为 fork 基座，代码自包含、零依赖，上游停更不影响使用**；架构干净使增量开发成本低。

### 3.2 abeage1/earwise —— ❌ 否决（无许可证）

- 身份：public，`main`，28 提交，2026-02-20 首提交、2026-02-27 后停更；0 stars；无 CI。
- 许可证：**仓库内无任何 LICENSE 文件**（find 逐一确认为空；GitHub API `license: null`）→ 默认 All Rights Reserved，**不可使用**。
- 功能（供参考）：B ❌、A ❌、F ⚠️（单一 triangle 合成）、H ⚠️（锁定式解锁）；C/D/E/G ✅（`js/intervals.js`、`js/chords.js:99-149` 转位数据正确、`js/storage.js`）；架构分离良好、零依赖、SM-2 间隔重复（spaced repetition）设计。
- 结论：功能面与 earpath-app 高度同源（同一作者），但**无许可证是硬阻断项**，且缺 A/B/F。否决。

### 3.3 qwell/440lab —— ❌ 否决（单体架构 + 功能缺口 + GPL §7(b) 负担）

- 身份：public，`main`，创建 2026-08-23、最近提交 2026-10-08（活跃），0 stars；线上 440lab.com。实为「调音器+节拍器+节奏+练耳」多功能工具，非专用练耳应用。
- 许可证：**GPL-3.0-or-later**（`LICENSE` 全文；`package.json:6`；`site/index.html:373` SPDX 标识）+ `ATTRIBUTION.md` 依据 GPLv3 §7(b) 强制要求衍生作品界面保留带超链的 "Based on 440 Lab by Jason Parker" 归属。GPL 本身可作开源基座使用，但要求全量 copyleft 且附带 UI 归属义务。
- 功能：A ✅（`site/assets/js/index.js:5967-6031`，无参考音单音辨音级类）、C ✅（13 音程 3 难度）、D ✅（仅 4 种三和弦）、G ✅（localStorage 统计，无历史时间轴）；B ❌（无 tonic/音级概念）、E ❌（无转位）、F ⚠️（仅 sine/triangle 两种波形，**无钢琴**）、H ⚠️（可调音程组/方向/八度/波形，和弦根音不可控）。
- 架构：**单文件 7115 行** `site/assets/js/index.js` 承载音频/题目/判分/UI 全部逻辑 → 违反本项目的模块化硬要求；无测试（`package.json` 无 test script）。
- 结论：数学与音频层可用，但作为"可维护基座"重写成本过高，且缺 B/E/钢琴音色。否决。

### 3.4 Kitkitkittt/chords-lab —— ❌ 否决（无许可证）

- 身份：public，`master`，41 提交，最近 2026-08-31；1 star；13 open issues；TypeScript + React + Tonal 乐理库 + Vitest/Playwright（98 个测试文件、约 574 个用例）。实为"乐理课程+练习平台"，练耳为附属模块。
- 许可证：**无任何 LICENSE 文件** → All Rights Reserved，**不可使用**。
- 功能（供参考）：A ❌、B ⚠️（无听觉音级题）、C/D ✅（窄题库）、E ❌（无听觉转位识别；setup 中 "inversions" 选项不生效——`src/lib/practiceGenerators.ts:362-407` 不读 topic）、F ✅ 纯合成无采样钢琴（`src/lib/audioEngine.ts:956-994`）、G ✅（FSRS 间隔重复 + IndexedDB）。
- 结论：工程质量高但**无授权**，且练耳覆盖窄。否决。若未来需复习算法设计灵感，可作参考阅读（非代码复用）。

### 3.5 ShacharHarshuv/open-ear —— ❌ 否决（法务风险 + 构建链腐化 + 隐私冲突）

- 身份：public，`master`，529 提交，最近提交 2026-09-24（活跃），**184 stars**、56 open issues；线上 Vercel 部署。候选中最成熟者。
- 许可证：**无 LICENSE 文件**，但 `README.md` 末尾内嵌完整 MIT 文本（Copyright 2021 Shachar Har-Shuv）→ 授权状态"可争议"（文本即授权，但 GitHub 未识别，且再分发须谨慎原样保留）；**采样资源署名不完整**：README 仅署名 piano samples "Jan Frost"，而包内声明采样为 CC-BY 3.0（Alexander Holm, Salamander Grand Piano V3），其余 19 种乐器目录结构与 tonejs-instruments（CC-BY 3.0）一致却无对应署名 → 直接复用样本存在版权合规风险。
- 功能：A ❌（无绝对音准练习）；B/C/D/E ✅（`src/app/exercise/...`，音级/音程/18+ 和弦类型/转位含七和弦）；F ⚠️（20 种采样乐器可选，默认钢琴；但纯合成音仅用于 drone，**不可作为题目音色**）；G ⚠️（仅会话内统计；且**逐题上报 Firebase Firestore + ipapi.co 采集 IP**，与"无后端/隐私极简"目标直接冲突）；H ✅（设置最丰富）。
- 工程：Angular + Ionic + Tone.js；**HEAD 处工具链已坏**：`pnpm ci` 报 "Unknown argument: sourceMap"，绕过后续测试编译失败（`storage-migration.service.spec.ts:138`），`--frozen-lockfile` 安装失败，Angular CLI 提示 Node 24 不受支持（本机为 Node v24）；静态产物 ~96MB（样本重复打包）。
- 结论：功能最全但代价高——法律不确定 + 署名义务 + 构建不可复现 + 需剥离 Firebase 上报 + 体量超标。否决。

## 4. 对比总表

| 候选 | 许可证 | A | B | C | D | E | F | G | H | 依赖/架构 | 测试 | 静态部署 | 结论 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **earpath-app** | ✅ MIT | ❌ | ✅ | ✅ | ✅ | ⚠️三和弦 | ❌单一合成 | ✅ | ⚠️ | 零依赖，13 模块分离 | ❌ | ✅零构建，线上可验 | **选用** |
| earwise | ❌ 无（ARR） | ❌ | ❌ | ✅ | ✅ | ✅ | ⚠️单一合成 | ✅ | ⚠️ | 零依赖，分离好 | ❌ | ✅ | 否决（授权） |
| 440lab | ⚠️ GPL-3.0-or-later +§7(b) | ✅ | ❌ | ✅ | ✅三和弦 | ❌ | ⚠️两波形 | ✅ | ⚠️ | 7115 行单体文件 | ❌ | ✅ | 否决（架构+缺口） |
| chords-lab | ❌ 无（ARR） | ❌ | ⚠️ | ✅ | ✅窄 | ❌ | ✅合成无钢琴 | ✅ | ⚠️ | React+TS+Tonal，分离优 | ✅ 98 文件 | ✅ vite 构建 | 否决（授权） |
| open-ear | ⚠️ README 内嵌 MIT，样本署名不全 | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️20 采样乐器（题目音色受限） | ⚠️含 Firebase 上报 | ✅ | Angular+Ionic，工具链坏 | ⚠️ 51 spec 但 HEAD 跑不通 | ⚠️ 96MB+联网依赖 | 否决（法务+工程） |

## 5. 许可证合规分析

- **可用**：earpath-app（MIT，最宽松）；440lab（GPL-3.0-or-later，附 §7(b) UI 归属义务，全量 copyleft）。
- **不可用**：earwise、chords-lab（无任何授权 → All Rights Reserved）。
- **高风险**：open-ear（README 内嵌 MIT 属"可争议授权"；19+1 种采样乐器署名链不完整，CC-BY 3.0 要求保留署名，直接复用其音频资产有侵权风险）。
- **禁止混合**：本项目已采用 MIT 基座，不得混入无许可证（ARR）仓库的代码；如未来参考 open-ear/440lab 的具体实现思路，须独立重写并避免代码与资产复制；如确需引入 GPL 代码则整个项目将受 GPL 传染，需用户明确决策。
- 导入执行：保留上游 `LICENSE` 全文与 README/文档中的来源声明（MIT 条款要求保留版权与许可声明）。

## 6. 选型结论（对照四项标准）

| 标准 | earpath-app 表现 |
|---|---|
| 极简 | 零第三方依赖、无构建、13 个模块 2371 行 JS、约 589KB 全仓库 |
| 功能完整 | 8 项需求中 2 ✅ + 4 ⚠️（部分）+ 2 ❌（缺口明确且**均为增量可加**，见 ROADMAP） |
| 代码可维护 | theory/audio/engine/state/session/views 单职责分离；新增题型只需 curriculum 注册 + engine 生成器；唯一短板是无测试（已列入 ROADMAP M1） |
| 静态部署 | 原生纯静态，线上 https://earpath.app/ 可验证；PWA 离线；无服务端依赖 |

对比中功能更全的 open-ear 因法务/工程/隐私三重风险被排除；440lab 单体架构与缺口代价更高。**结论：earpath-app 为四项标准下的最优基座，已导入本项目。**

### 已知的选型代价（必须正视）

1. 缺失需求 ①（绝对音准）与 ⑥（音色切换）——两项均为"新增模块"，不需改动既有架构；
2. 无测试、无 CI——需在 M1 建最低测试基建（Node 内置 `node:test`，保持零依赖）；
3. 上游极年轻（1 star、2 个月无更新）——按 fork 自维护对待，不依赖上游节奏；
4. 上游使用 Google Fonts / PostHog 外链——PostHog 已在导入时关闭；字体有系统回退，后续可本地化。

## 7. 导入时的代码修改记录

| 文件 | 修改 | 理由 |
|---|---|---|
| `CNAME` | 删除 | 内容为 `earpath.app`（上游域名），保留会使本项目部署指向他人站点 |
| `js/config.js:7` | `POSTHOG_KEY` 置空字符串 | 上游注释明确"留空即禁用全部统计"；本项目隐私优先，避免向第三方上报使用数据 |

其余文件与上游 `f5241f5` 逐字节一致（README.md 替换为本项目自述，属正常项目化操作；`LICENSE`、`CHANGELOG.md`、`marketing/` 原样保留以溯源）。

## 8. 不确定项与未验证事项（诚实清单）

- 各候选仓库 star 数、archived 状态为 2026-10-13 快照，会随时间变化；
- 线上站点的实跑行为（earpath.app）仅静态核对源码 + HTTP 可达性，未逐功能交互测试；
- open-ear 的钢琴样本确切来源（文件名与包内命名不一致）未证实；19 种乐器与 tonejs-instruments 未做逐文件哈希比对；
- 440lab 总提交数可能大于 35（浅克隆统计）；其页面内是否运行时注入 GPL §7(b) 归属文本未动态验证；
- chords-lab / earwise 未运行其测试或构建（对应否决结论不依赖运行结果）；
- earpath-app 的 `css/style.css`（790 行）未逐条通读；未做移动端真实设备测试。

## 9. 复现命令

```bash
cd D:/project/music-ear
mkdir -p .baseline-review && cd .baseline-review
git clone --depth 30 https://github.com/abeage1/earpath-app  earpath-app
git clone --depth 30 https://github.com/abeage1/earwise       earwise
git clone --depth 30 https://github.com/qwell/440lab          440lab
git clone --depth 30 https://github.com/Kitkitkittt/chords-lab chords-lab
git clone --depth 30 https://github.com/ShacharHarshuv/open-ear open-ear
# 许可证核查
find . -maxdepth 2 -iname "*licen*"
# 元数据核查（如 API 限额未满）
curl -s https://api.github.com/repos/abeage1/earpath-app | grep -E '"license"|"archived"|"stargazers_count"'
```

> 注：`.baseline-review/` 仅供本地取证，已在 `.gitignore` 中排除。其中 earwise、chords-lab 为 All Rights Reserved 仓库，请勿将其代码以任何形式引入本项目。
