# music-ear（工作名，待定）

极简但功能齐全的开源音乐练耳 Web 应用。纯静态部署（GitHub Pages / Cloudflare Pages 等），无后端、无账号、无数据库；训练进度仅保存在浏览器本地（localStorage）。电脑与手机浏览器均可使用。

准确、可维护的乐理（music theory）数据、音频（audio）与判分（grading）优先于花哨 UI。

## 产品需求（v1 目标）

1. **绝对音准（absolute pitch）**：无参考音，听单音辨音名
2. **相对音准 / 调内音级辨别（scale degree）**：先给出调性上下文（终止式 cadence），再辨音级
3. **音程听辨（interval）**
4. **和弦类型听辨（chord type）**
5. **和弦转位的听觉辨别（chord inversion）**
6. **音色切换（timbre）**：至少基础合成音（synth）+ 钢琴（piano），架构可扩展更多音色
7. **训练统计**：正确率 / 连对 / 活动热图等，本地持久化
8. **自定义训练**：题型、关卡（范围）、音域

## 当前状态

以 [earpath-app](https://github.com/abeage1/earpath-app) v0.2.2（commit `f5241f5`，MIT License）为基座导入，本项目当前版本 **0.3.0**。零第三方运行时依赖、无构建步骤的原生 ES Module（ECMAScript Module）静态站。

| 需求 | 现状 |
|---|---|
| ① 绝对音准 | ✅ 已有（0.3.0 新增 Absolute Pitch 模块：单音无参考音，按音级类判分） |
| ② 调内音级 | ✅ 已有（Scale Degrees 模块，先奏终止式建立调性，可切 solfège/数字） |
| ③ 音程 | ✅ 已有（12 种 × 升/降/同时 + 复合音程） |
| ④ 和弦类型 | ✅ 已有（13 种：三和弦/七和弦/sus/六和弦/九和弦） |
| ⑤ 和弦转位 | ⚠️ 部分（仅大三/小三三和弦的 1/2 转位；无七和弦转位） |
| ⑥ 音色切换 | ❌ 缺失（仅单一合成音色；见 ROADMAP M2） |
| ⑦ 统计 | ✅ 已有（逐技能正确率、连击、12 周热图、混淆对分析、JSON 导入导出） |
| ⑧ 自定义 | ⚠️ 部分（可任选关卡，无音域/题型直选） |

差距与计划见 [docs/ROADMAP.md](docs/ROADMAP.md)；选型证据见 [docs/BASELINE_REVIEW.md](docs/BASELINE_REVIEW.md)。

导入时对上游代码的修改（详见 BASELINE_REVIEW 附录）：

- 删除 `CNAME`（`earpath.app` 为上游自有域名，保留会导致部署指向他人站点）
- `js/config.js` 中 `POSTHOG_KEY` 置空 → 按上游设计（留空即完全禁用）关闭匿名统计

## 架构

| 文件 | 职责 |
|---|---|
| `js/theory.js` | 乐理数据：音程 / 和弦 / 音阶 / 音级 / 罗马数字；MIDI↔频率 |
| `js/curriculum.js` | 模块与关卡注册表、解锁规则 |
| `js/audio.js` | Web Audio 合成引擎与事件编排（后续音色扩展的重点） |
| `js/engine.js` | 题目生成与判分（每个模块一个生成器 + 判分函数） |
| `js/state.js` | localStorage 持久化、逐技能统计、设置 |
| `js/session.js` / `js/views.js` / `js/piano.js` / `js/ui.js` | 练习界面 / 页面视图 / 屏幕键盘 / DOM 工具 |
| `tests/` | `node --test` 测试：乐理数据 + 模块注册 + 出题/判分不变量 |
| `sw.js` | 离线缓存（network-first，联网时即时更新） |

## 本地运行

ES Module 需经 HTTP 服务（不能以 `file://` 直接打开）：

```bash
# 方式一（本机 Python）
E:/software/miniforge/python.exe -m http.server 8123
# 方式二
npx serve .
```

打开 http://localhost:8123 。`localhost` 下匿名统计已被上游逻辑禁用，不影响开发。

> 开发提示：`python -m http.server` 不发送 `Cache-Control`，浏览器可能用启发式缓存命中旧的 ES Module，导致"改了代码却看不到效果"。改完 `js/*.js` 后若页面行为没变，换一个新端口访问，或在 DevTools 里勾选 "Disable cache" 后硬刷新（service worker 本身是 network-first，但拦不住 HTTP 缓存）。

## 测试

乐理数据（频率换算、音程半音数、和弦结构与转位、音阶集合、罗马数字、模块注册完整性）是判分的地基，因此由测试守护：

```bash
npm test          # 等价于 node --test（Node 内置测试运行器，零依赖）
```

`package.json` 只为测试存在（`type: module` + 一个 test 脚本，无任何依赖）；应用本身仍然是「仓库根目录即产物」的纯静态站。

## 部署

纯静态：将仓库根目录直接发布到任意静态托管（GitHub Pages / Cloudflare Pages / Netlify），无构建步骤。若部署到子路径（如 `https://<user>.github.io/music-ear/`），需核对 `manifest.webmanifest` 的 `start_url` / `scope` 与 `sw.js` 缓存列表是否兼容子路径（见 ROADMAP 风险项）。

## 上游归属与许可证

- 本仓库包含源自 [earpath-app](https://github.com/abeage1/earpath-app)（v0.2.2，commit `f5241f5`）的代码，依其 **MIT License** 使用。
- `LICENSE` 为上游原始许可证文本（Copyright (c) 2026 abeage1），按 MIT 条款原样保留。
- `CHANGELOG.md` 中 v0.2.2 及以前条目、`marketing/` 目录为上游历史与产品材料，仅作溯源保留，不代表本项目现状。
- 本项目为独立分支（fork），并非上游官方项目；再分发须保留 `LICENSE` 与本说明。
