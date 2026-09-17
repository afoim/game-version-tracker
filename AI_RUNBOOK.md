# AI_RUNBOOK

本仓库由 `.github/workflows/ai-tracker.yml` 定时维护 `data/games.json`。

## 执行链

```text
GitHub Actions
  -> main-agent
  -> Playwright search-worker
  -> 9 个 child-agent
  -> review-agent
  -> approved 后写 data/games.json
  -> git commit / push
```

## main-agent

main-agent 读取当前 `data/games.json`，必须为以下 9 个游戏各生成一个独立任务，不得遗漏或重复：

1. 原神
2. 崩坏：星穹铁道
3. 崩坏3
4. 绝区零
5. 鸣潮
6. 明日方舟：终末地
7. 异环
8. 蔚蓝档案（日服）
9. 星塔旅人（国服）

main-agent 只负责拆分核验目标和生成搜索查询，不直接修改仓库。

## search-worker

搜索与网页读取由 Playwright 完成，AI 不自行联网。

每个游戏优先核验：

- 官方 API / 官方网站
- 官方公告 / 官方社区
- 现有 `sources`
- 公开搜索发现的可靠页面

Playwright 读取正文和可用的网络 JSON，并把本轮真实证据交给对应 child-agent。

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

核验内容包括当前版本、当前主要内容、下一版本、前瞻状态、当前 UP / 卡池、相关日期和剩余天数。

## review-agent

review-agent 独立检查整轮候选结果，不修改仓库。

必须检查：

- 9 个游戏是否完整且没有重复。
- JSON 和必填字段是否合法。
- 已核验候选的 `sources` 是否来自本轮 Playwright 真实读取的 URL。
- 日期、日期顺序和剩余天数是否合理。
- 已结束卡池是否错误地继续显示为当前 UP。
- 所有事实变化是否有 evidence 支持。
- 是否存在明显幻觉、来源与结论不匹配或把推测写成确认。

`insufficient` 是允许的安全降级，不自动导致整轮失败；该游戏必须保持旧事实。其他游戏中有可靠证据的变化仍可继续审核和提交。

只有结构错误、缺失 child-agent、无证据却宣称 verified、证据不足却修改旧事实、变化缺乏来源、明显幻觉等情况才拒绝整轮写入。

## 写入和提交

orchestrator 只把 `verified` 且存在实质事实变化的候选合并进最终数据。

- 未变化游戏不刷新 `sources/checked_at`，避免仅因核验时间产生空提交。
- `insufficient` 游戏完整保留旧数据。
- review-agent 未批准时不得写 `data/games.json`。
- review-agent 批准后才允许写入。
- Action 在提交前再次运行数据校验。
- Action 只接受 `data/games.json` 的 tracked diff；发现其他 tracked 文件变化立即失败。
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
