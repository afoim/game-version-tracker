# Game Version Tracker

由 GitHub Actions 定时运行的 AI Agent 游戏版本维护仓库。发布 `data/games.json`、`data/media-feed.json` 与 `data/media/**`。

## 维护游戏

1. 原神
2. 崩坏：星穹铁道
3. 崩坏3
4. 绝区零
5. 鸣潮
6. 明日方舟：终末地
7. 异环
8. 星塔旅人（国服）

## 架构

```text
GitHub Actions
    |
    v
main-agent
    |
    +---- child-agent × 8
    |         |
    |         v
    |    search-worker / Playwright
    |
    v
review-agent
    |
    v
approved ? games.json + media-feed.json + media/* : 保留旧数据
    |
    v
git commit / push
```

- `main-agent` 读取当前数据并为全部 8 个游戏生成独立核验任务。
- `search-worker` 不使用搜索引擎，也不读取官网、TapTap、微博、YouTube 等其他平台；只打开程序内固定白名单中的 Bilibili 官方账号空间，截获 Bilibili 页面自身发出的动态流请求，并读取该账号发布的官方视频。
- 每个 `child-agent` 只分析一个游戏，只能使用本轮 Playwright 实际读取的证据，只返回结构化 JSON，不写仓库。
- `review-agent` 独立检查结构、来源、日期、变化证据和明显幻觉风险。
- 某个游戏证据不足时安全降级：保留该游戏旧事实，继续审核其他游戏，不猜测数据。
- 只有 review-agent 批准的可靠事实变化才会写入 `data/games.json`。
- GitHub Actions 只允许提交 `data/games.json`、`data/media-feed.json` 与 `data/media/**`；没有变化时不创建空提交。

## 服务端驱动媒体 Feed

`data/media-feed.json` 是前端的新入口，schema v2 顶层固定为三部分：

- `ui`：服务端决定 section 顺序、组件类型、字段绑定、筛选项、列数和展示开关。
- `data`：真实游戏版本数据，当前直接包含完整 `games` 数据。
- `media`：从固定 Bilibili 官方账号动态中提取的官方视频资源。

每个 `data.games[]` 还会额外下发 `icon_url`。8 个游戏图标由后端仓库统一发布在 `data/media/game-icons/`，前端不维护游戏名到图标路径的硬编码映射。

当前生产 UI 只下发一个 `game_status_grid` 主 section，版本状态卡始终是页面主体；官方版本 PV、角色 PV、前瞻节目等媒体通过 `props.embedded_media` 嵌入对应游戏卡片内部。前端只负责解释该配置，不自行决定媒体位置和数量。`media_grid` 解释器仍保留用于协议兼容，但生产 Feed 不再把它作为独立首屏 section。

官方视频采用确定性标题分类，不由模型自由判断：

- `version_pv`：版本 PV / 版本宣传片 / Version Trailer。
- `character_pv`：角色 PV / 角色演示 / 角色展示。
- `preview_program`：版本前瞻 / 特别节目 / 前瞻通讯。
- `short_film`：动画短片 / 剧情短片等。
- `promotional_pv`：其他官方 PV / Trailer。

视频本体始终指向官方 Bilibili；封面从 Bilibili CDN 下载到 `data/media/catalog/<game>/<bvid>.*` 后再由本站提供，避免前端直接热链封面。

## AI

OpenCode Zen：

- endpoint: `https://opencode.ai/zen/v1`
- model: `muse-spark-1.3-contributor-free`
- API key: `public`
- 每次 Action 使用动态请求会话：`game-version-tracker-${github.run_id}`

Agent 编排、证据约束和审核逻辑位于 `agent/`。OpenCode 负责模型 transport，Playwright 负责网络读取，模型本身不执行搜索。

## GitHub Actions

工作流：`.github/workflows/ai-tracker.yml`

支持：

- `schedule`：每天自动执行。
- `workflow_dispatch`：手动执行。
- 手动执行可选择 `dry_run=true`，完整运行 Agent 流程但不写入/提交数据。
- 缓存 npm `node_modules` 和 Playwright Chromium。
- 每轮上传 `agent-output/report.json` 作为 Action artifact。

手动运行正式维护：

```bash
gh workflow run ai-tracker.yml --ref master
```

手动 dry-run：

```bash
gh workflow run ai-tracker.yml --ref master -f dry_run=true
```

查看运行：

```bash
gh run list --workflow ai-tracker.yml
gh run view <run-id> --log
```

### Bilibili 登录态

GitHub Actions 出口可能触发 Bilibili 412 / 风控。可在仓库 Actions Secrets 中配置 `BILIBILI_COOKIE`，内容为完整的 Bilibili `Cookie` 请求头字符串。

运行时只把该 Secret 注入 Playwright 的 `.bilibili.com` Cookie Jar；不会写入仓库、`agent-output`、`sources` 或日志。未配置或登录态失效时，如果 Bilibili 对某个官方空间触发 412 / -352 风控，该游戏会安全降级为 evidence 不足，不会回退到其他平台。

建议保存完整 Cookie 以降低因风控字段缺失造成的失败；若必须最小化，通常至少包含 `SESSDATA`、`bili_jct`、`DedeUserID`，但平台要求可能变化。

## 数据规则

- 永远保留完整 8 个游戏和现有前端字段；`蔚蓝档案（日服）` 已移除。
- 新一轮核验的数据源只允许来自程序内固定白名单中的 Bilibili 官方账号动态与官方视频；历史非 Bilibili `sources` 会在该游戏下一次 verified 时迁移掉。
- 前瞻使用独立字段：`preview_title`、`preview_start_at`、`preview_live_url`、`preview_replay_url`；未知值使用 `null`。
- `preview_images` 保存前瞻相关官方动态的本站发布配图 URL；原图下载到 `data/media/<game>/<dynamic-id>/`，最多 4 张，不让前端直接热链 Bilibili CDN。
- `preview_start_at` 必须是带时区的 ISO 8601；前瞻日期不能冒充版本上线日期。
- 节目结束后继续核验 Bilibili 官方账号录播/回放；第三方搬运、解说、切片或其他平台视频不能写入 `preview_replay_url`。
- 事实变化必须有本轮真实读取的来源支持。
- `sources` 中的来源包含 `title`、`url`、`type`、`claims`、`checked_at`。
- 新核验产生的 `sources.type` 固定为 `official_community`。
- 未确认日期保持“预计 / 未确认”语义。
- 已结束卡池不能继续作为当前 UP。
- 证据不足时保留旧值，而不是让模型猜测。

详细 Agent 行为见 `AI_RUNBOOK.md`。
