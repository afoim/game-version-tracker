# AI_RUNBOOK

本仓库由 `.github/workflows/ai-tracker.yml` 定时维护 `data/games.json`、`data/media-feed.json` 与 `data/media/**`。

## 执行链

```text
GitHub Actions
  -> main-agent
  -> Playwright search-worker
  -> 8 个 child-agent
  -> review-agent
  -> approved 后写 games.json + media-feed.json + media/**
  -> git commit / push
```

## main-agent

main-agent 读取当前 `data/games.json`，必须为以下 8 个游戏各生成一个独立任务，不得遗漏或重复：

1. 原神
2. 崩坏：星穹铁道
3. 崩坏3
4. 绝区零
5. 鸣潮
6. 明日方舟：终末地
7. 异环
8. 星塔旅人（国服）

main-agent 只负责拆分核验目标，不直接修改仓库，也不生成搜索查询。

## search-worker

网页读取由 Playwright 完成，AI 不自行联网。search-worker 不使用 Bing、DuckDuckGo 或其他搜索引擎。

每个游戏只读取程序内固定白名单中的 Bilibili 官方账号空间。Playwright 打开官方账号的动态页，截获 Bilibili 页面自身发出的、带 WBI 签名的 `/x/polymer/web-dynamic/v1/feed/space` 请求，并从最近动态与官方视频中挑选与当前版本、下一版本、前瞻和卡池最相关的 evidence。

不会使用官网、TapTap、微博、HoYoLAB、YouTube、新闻站或第三方搬运作为新一轮事实来源。历史非 Bilibili `sources` 仅作为旧数据留存，待该游戏下一次 verified 后由 Bilibili 官方来源替换。

Bilibili 页面/API 若触发 412 / -352 风控，可通过 `BILIBILI_COOKIE` Actions Secret 注入 `.bilibili.com` Cookie Jar。Secret 内容不得进入日志、report、evidence 文本或 `sources`。登录态不可用时该游戏安全降级为 `insufficient`，不回退其他平台。

同一次官方空间读取同时产生两类结果：

- evidence：送给 child-agent 做版本事实核验。
- media catalog：不交给模型自由分类，直接从官方视频标题确定 `version_pv` / `character_pv` / `preview_program` / `short_film` / `promotional_pv`。

媒体目录写入 `data/media-feed.json`。视频地址保持官方 Bilibili，封面复制到 `data/media/catalog/` 后发布本站 URL。

`media-feed.json` schema v2 顶层固定为：

- `ui`：服务端驱动页面 section、组件类型、顺序和组件 props。当前生产 Feed 只下发 `game_status_grid` 主 section，并通过 `props.embedded_media` 把官方媒体嵌入对应游戏卡片。
- `data`：真实游戏数据。
- `media`：官方视频与封面资源；前端按 `game_name` 与 `embedded_media` 规则过滤到各自游戏卡片。

## child-agent

每个 child-agent 只负责一个游戏，并且：

- 只能使用本轮 search-worker 提供的 evidence。
- 不允许读取或写入仓库。
- 不允许 commit / push。
- 不允许使用模型记忆补充外部事实。
- 只返回结构化 JSON。
- 必须返回完整游戏对象。
- 证据不足时返回 `verification_status=insufficient`，并保留旧事实。
- 只有证据明确支持时才允许修改事实字段。

核验内容包括当前版本、当前主要内容、下一版本、前瞻状态、前瞻标题、前瞻开始时间、官方直播地址、官方录播/回放地址、当前 UP / 卡池、相关日期和剩余天数。

前瞻字段：

- `preview_title`: Bilibili 官方账号发布的节目标题。
- `preview_start_at`: Bilibili 官方动态公布的带时区 ISO 8601 开播时间。
- `preview_live_url`: Bilibili 官方直播间或预约页。
- `preview_replay_url`: Bilibili 官方账号发布的完整录播/回放；不得使用第三方搬运、解说、切片或其他平台视频。
- `preview_status=已发布` 不代表前瞻核验结束；仍必须尝试寻找 Bilibili 官方录播。

## review-agent

review-agent 独立检查整轮候选结果，不修改仓库。

必须检查：

- 8 个游戏是否完整且没有重复。
- JSON 和必填字段是否合法。
- 已核验候选的 `sources` 是否来自本轮 Playwright 真实读取、且 `discovered_by` 为 `bilibili-official:*` 的固定官方账号 evidence。
- 日期、日期顺序和剩余天数是否合理。
- 前瞻开播时间是否有时区、是否误当版本上线日期；录播链接是否确为 Bilibili 官方账号。
- 已结束卡池是否错误地继续显示为当前 UP。
- 所有事实变化是否有 evidence 支持。
- 是否存在明显幻觉、来源与结论不匹配或把推测写成确认。

`insufficient` 是允许的安全降级，不自动导致整轮失败；该游戏必须保持旧事实。其他游戏中有可靠证据的变化仍可继续审核和提交。

只有结构错误、缺失 child-agent、无证据却宣称 verified、证据不足却修改旧事实、变化缺乏来源、明显幻觉等情况才拒绝整轮写入。

## 写入和提交

orchestrator 合并 `verified` 的可靠事实变化；同时允许在事实不变时把历史多源 `sources` 一次性迁移成 Bilibili 官方来源。

- 未变化游戏不刷新 `sources/checked_at`，避免仅因核验时间产生空提交。
- `insufficient` 游戏完整保留旧数据。
- review-agent 未批准时不得写 `data/games.json`。
- review-agent 批准后才允许写入。
- Action 在提交前再次运行数据校验。
- Action 只接受 `data/games.json`、`data/media-feed.json` 与 `data/media/**` 的数据变更；`data/` 下出现其他变化立即失败。
- 没有数据变化时不 commit。
- 有变化时使用 `github-actions[bot]` commit，并在 push 前 fetch/rebase 最新 `master`；禁止 force push。

## OpenCode Zen

- endpoint: `https://opencode.ai/zen/v1`
- model: `muse-spark-1.3-contributor-free`
- API key: `public`
- `x-opencode-session`: `game-version-tracker-${github.run_id}`

每次 workflow run 使用自己的动态 session，不使用固定值。

## 手动验证

正式运行：

```bash
gh workflow run ai-tracker.yml --ref master
```

dry-run：

```bash
gh workflow run ai-tracker.yml --ref master -f dry_run=true
```

查看日志：

```bash
gh run list --workflow ai-tracker.yml
gh run view <run-id> --log
```
