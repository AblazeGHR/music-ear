# music-ear（工作名，待定）

极简但功能齐全的开源音乐练耳 Web 应用。纯静态部署（GitHub Pages / Cloudflare Pages 等），无后端、无账号、无数据库；训练进度仅保存在浏览器本地（localStorage）。电脑与手机浏览器均可使用。

形态参考 [tonedear.com](https://tonedear.com/ear-training/intervals)：**没有关卡、解锁、连击或引导**——首页就是练习列表，点进去直接开练，每个练习自带 Options 面板，题目池、方向、音域全都可调。

- ✋ **手势模式**（练习页右上角开关，为闭眼练习设计，可在设置里选两种）：
  - **连击计数**（默认）：单击/连击 N 次 = 第 N 个选项（每击一声滴答便于计数）、**长按 = 退出手势模式**
  - **长按计数**：按住不动，每隔设定的毫秒数（默认 500，设置里可改 200–2000）响一声，松手停止，响 N 声 = 第 N 个选项；**连按三下 = 退出手势模式**
  - 两种模式共用：**划直线 = 下一题**、**来回滑动一次 = 重播**、答错后**来回滑动两次 = 语音播报答案名**（"You chose X. The answer was Y."，浏览器内置语音引擎，零依赖、不联网）；开启后除开关外**所有控件锁定**（含返回、Options、键盘快捷键），答错还会自动连播「你的选择 + 正确答案」两音。**所有选择题练习都开放手势**，不再限制选项数量；选项很多时是否值得数那么多下，由你判断（和弦默认 11 项、绝对音感 12 项都可以用）
- 🎙 **语音作答（选择题）**：练习页的 🎙 开关打开后**持续监听**，不用按住、也不用每题重新开——说选项名（"perfect fifth"、"major first inversion"、"C sharp"、"re"）或序号（"five" / "fifth"、"option three" / "option third"）直接作答；单词若同时是选项名的一部分（如度数练习的 "three" 指 Mi），按位置作答请说 "option three"，`replay` / `next` / `names` / `stop listening` 执行对应动作；关掉开关或**连续无识别成功超过设定时长**（默认 10 分钟，设置里可调 1–60）才停止。安卓端用内置 Vosk 模型**离线**识别，网页端用浏览器的语音识别（需要网络）
- 🎼 **视奏**（第 9 个练习）：五线谱（C4–C6）或六线谱（G3–G4、0–4 品）上写一段旋律，用屏幕键盘按顺序弹回；作答前不出声，答完在谱面与槽位逐音标出对错
- ⏭ **答题前可跳过**：题目标题下方固定一个「下一题 →」，未作答时是次要样式、不计分不动统计，作答后原地变成主按钮，位置和尺寸始终不变。题目说明默认折叠，点击标题展开、再点收起
- ↕️ 答案按钮固定按乐理顺序排列（音程按半音升序、音级升序、罗马数字 I–vi…），与选项的点击顺序无关
- 🔁 **答错后可以试听每个选项**：点任意选项、说它的名字、在手势模式下点 N 次、或按对应数字键，都会播放该选项的声音；原来的对比按钮仍在

准确、可维护的乐理（music theory）数据、音频（audio）与判分（grading）优先于花哨 UI。

## 产品需求与现状（v0.5.0）

| # | 需求 | 现状 |
|---|---|---|
| ① | 绝对音准（absolute pitch） | ✅ 单音无参考音辨音名（12 音名可选池，音域可调） |
| ② | 相对音准/调内音级（scale degree） | ✅ 先奏终止式建立调性再辨音级，solfège/数字可切 |
| ③ | 音程听辨（interval） | ✅ 16 种音程 × 升/降/和声三方向，池可自选 |
| ④ | 和弦类型听辨（chord type） | ✅ 34 种（三和弦/七和弦/sus/六和弦/九和弦） |
| ⑤ | 和弦转位（chord inversion） | ✅ 三和弦 1/2 转位 + 七和弦 1/2/3 转位（dim7 因等音对称刻意不含） |
| ⑥ | 音色切换（timbre） | ❌ 仅单一合成音；排在最后阶段作为计划（docs/ROADMAP.md M4） |
| ⑦ | 训练统计 | ✅ 总正确率、逐练习正确率、**逐答案选错率与选错分布**（统计页两级折叠）、"常混淆"对及回放；JSON 导入导出；统计页 ↔ 练习页双向跳转 |
| ⑧ | 自定义训练（题型/范围/音域） | ✅ 每个练习的 Options 面板：题目池多选、方向、调性、音域（MIDI）、长度与开关 |
| ⑨ | 视奏（sight reading） | ✅ 五线谱/六线谱二选一，4–16 音、四种节奏型；纯 SVG 自绘谱面（高音谱号、加线、连桁、六线谱 0–4 品），键盘按序弹回，逐音判分并在谱面标错 |

## 架构

零第三方运行时依赖、无构建步骤的原生 ES Module（ECMAScript Module）静态站，"仓库根目录即产物"。

| 文件 | 职责 |
|---|---|
| `js/theory.js` | 乐理数据：音程/和弦（含转位）/音阶/音级/罗马数字；MIDI↔频率 |
| `js/curriculum.js` | 练习注册表：展示元数据 + 默认题目配置 + Options 描述 |
| `js/audio.js` | Web Audio 合成引擎与事件编排 |
| `js/engine.js` | 题目生成与判分：`generate(moduleId, cfg)` |
| `js/reading.js` | 视奏出题：音池、节奏单元、走向约束、六线谱把位、判分 |
| `js/notation.js` | 纯函数谱面绘制：五线谱（谱号/加线/符干/连桁）与六线谱，输出自包含 SVG |
| `js/state.js` | localStorage 持久化（`music-ear-v1`）、逐技能统计、配置合并 |
| `js/options.js` | 配置驱动的 Options 面板渲染 |
| `js/session.js` | 练习界面：答题 UI（选择/序列/旋律）、反馈、快捷键 |
| `js/views.js` | 首页、统计、设置、Guide |
| `js/piano.js` / `js/ui.js` | 屏幕键盘 / DOM 工具 |
| `tests/` | `node --test` 测试（乐理数据 + 注册表 + 出题/判分 + 持久化） |
| `sw.js` | 离线缓存（network-first） |

## 本地运行

ES Module 需经 HTTP 服务（不能以 `file://` 直接打开）：

```bash
# 方式一（本机 Python）
E:/software/miniforge/python.exe -m http.server 8123
# 方式二
npx serve .
```

打开 http://localhost:8123 。

> 开发提示：`python -m http.server` 不发送 `Cache-Control`，浏览器可能用启发式缓存命中旧的 ES Module，导致"改了代码却看不到效果"。改完 `js/*.js` 后若页面行为没变，换一个新端口访问，或在 DevTools 里勾选 "Disable cache" 后硬刷新（service worker 本身是 network-first，但拦不住 HTTP 缓存）。

## 测试

乐理数据是判分的地基，由测试守护（Node 内置测试运行器，零依赖）：

```bash
npm test          # 等价于 node --test
```

`package.json` 只为测试存在（`type: module` + 一个 test 脚本，无任何依赖）。

## 部署

**线上站点：<https://trainear.ablaze.dpdns.org>**（Cloudflare Workers + Static Assets；自定义域由 `wrangler.jsonc` 的 `custom_domain` 路由在部署时自动创建，无需手工配 DNS）

```bash
npm run deploy    # 需要环境变量 CLOUDFLARE_API_TOKEN
```

`scripts/deploy.mjs` 把运行时文件（`index.html`、`css/`、`js/`、`assets/`、`manifest.webmanifest`、`sw.js`）复制进 `dist/` 后交给 wrangler 上传——docs/tests/marketing 等非运行时文件不会发布。仓库根目录本身就是应用，`dist/` 只是发布暂存，不需要手动维护。

纯静态无构建，也可以发布到任意其他静态托管（GitHub Pages / Cloudflare Pages / Netlify）。若部署到子路径（如 `https://<user>.github.io/music-ear/`），需核对 `manifest.webmanifest` 的 `start_url`/`scope` 与 `sw.js` 缓存路径是否兼容子路径（见 ROADMAP 风险项）。

## 安卓应用（实验）

同一份静态站点可以打包成离线安卓应用。`android/` 是一个原生壳（WebView + 内置静态资源 + 系统 TTS + 内置 Vosk 离线识别），构建时把运行时文件复制进 APK，装上即可用、飞行模式下也能完整练习。

```bash
npm run android                     # 双语 debug APK（中英两个模型，可切换，约 96 MB）
npm run android:release             # 中文 release 包（精简，单模型，未签名）
npm run android:en:release          # 英文 release 包（精简，单模型，未签名）
npm run android:icons               # 改过 assets/icon.svg 后重新生成启动图标（需 Pillow）
```

**debug 默认双语**：两个 Vosk 模型都打进 APK，启动不带 `?lang=`，设置里可随时切换界面、朗读和识别语言；切换时原生桥按需加载对应模型（首次各解压一次，之后复用）。**只有 release 走精简版**：单模型、`?lang=` 锁定、隐藏语言切换。

- 需要 JDK 17+ 与 Android SDK（`ANDROID_HOME`）；Gradle 由 wrapper 首次运行时下载。最低 Android 8.0（API 26），WebView 建议 Chrome 80+。
- **体积**：双语 debug 约 96 MB（两个模型）；单语言 release 约 54 MB（一个模型）。模型不提交进仓库，`npm run android` 首次构建会自动下载（`npm run android:model` 可单独执行）；每种语言首次启用语音时解压到私有目录（1–2 秒）。
- **语音完全离线**：Vosk small en-US + 每题动态 grammar（只允许当前选项名与四个命令），麦克风音频不出设备；不再依赖 Google 语音服务。
- 安卓 WebView 没有可用的 Web Speech 语音，壳里通过 `AndroidTTS` 桥接系统 TTS，`js/speech.js` 检测到桥接时优先使用；壳内不注册 Service Worker（文件已在 APK 里）。
- 字体（Outfit woff2）随包内置，WebView 对一切非本地请求返回 403，网页端也不再请求 Google Fonts。
- **锁屏语音练习（原生）**：开启 🎙 时页面会预生成 60 道题的队列（音频事件、选项、正确答案、识别别名）交给原生；锁屏或切到后台后，前台服务用 `AudioTrack` 合成播放、Vosk 识别、判分并用系统 TTS 报结果，整条链路不再依赖 WebView 的 JS 计时器和 AudioContext。答题、序号、`重播/下一题/报答案/关闭语音` 在熄屏下都可用；答错后说出选项名可试听该选项。回到应用时原生结果并回统计并刷新分数。仅支持选择题（和弦进行与旋律听写没有选项格）；空闲超时、关闭语音、划掉任务都会停止服务。建议在设置 → 后台运行里允许忽略电池优化，国产 ROM 还需关闭自动管理。
- 页面里指向 GitHub / changelog / mailto 的链接会交给系统浏览器或邮件应用打开。

## 第三方资源

- 图标：[Lucide](https://lucide.dev)（ISC，见 `assets/icons/LICENSE`）
- 字体：Outfit（SIL OFL，见 `assets/fonts/OFL.txt`）
- 乐谱字形：[Bravura](https://github.com/steinbergmedia/bravura)（SMuFL 参考字体，SIL OFL 1.1，见 `assets/fonts/Bravura-OFL.txt`）。只内联了谱号、拍号、符头、符尾和附点几个字形的路径，由 `scripts/build-music-glyphs.py` 生成 `js/music-glyphs.js`

## 数据与隐私

- 进度与设置存于 localStorage（key `music-ear-v1`），可 JSON 导出/导入；无任何网络请求（不含分析与遥测）
- 语音作答只在开启 🎙 时打开麦克风：安卓端识别全在本机完成；网页端交给浏览器的语音识别服务（Chrome 会发送到 Google，可能因网络不可用而失败），本应用不接收也不保存音频
- 0.3.x 及更早使用旧 key `earpath-v1` 与关卡制数据结构，不兼容且不会被读取

## 上游归属与许可证

- 本仓库包含源自 [earpath-app](https://github.com/abeage1/earpath-app)（v0.2.2，commit `f5241f5`）的代码，依其 **MIT License** 使用；`LICENSE` 为上游原始许可证文本（Copyright (c) 2026 abeage1），按 MIT 条款原样保留
- `CHANGELOG.md` 中 0.2.2 及以前条目、`marketing/` 目录为上游历史与产品材料，仅作溯源保留
- 0.4.0 起重写为无关卡的扁平练习形态（参考 tonedear 的交互模式，未使用其代码）
- 本项目为独立分支（fork），并非上游官方项目；再分发须保留 `LICENSE` 与本说明

## 文档

- `docs/BASELINE_REVIEW.md` — 候选基座对比、证据与选型理由
- `docs/ROADMAP.md` — 里程碑、验收标准与风险
