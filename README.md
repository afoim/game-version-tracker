# Game Version Tracker

由 GitHub Actions 定时运行的 AI Agent 游戏版本维护仓库。唯一发布数据文件是 `data/games.json`。

## 维护游戏

1. 原神
2. 崩坏：星穹铁道
3. 崩坏3
4. 绝区零
5. 鸣潮
6. 明日方舟：终末地
7. 异环
8. 蔚蓝档案（日服）
9. 星塔旅人（国服）

## 架构

```text
GitHub Actions
    |
    v
main-agent
    |
    +---- child-agent × 9
    |         |
    |         v
    |    search-worker / Playwright
    |
    v
review-agent
    |
    v
approved ? data/games.json : 保留旧数据
    |
    v
git commit / push
```

- `main-agent` 读取当前数据并为全部 9 个游戏生成独立核验任务。
- `search-worker` 使用 Playwright 打开现有来源、公开搜索结果、官网页面及可发现的网络 JSON；搜索/抓取与 AI 分离。
- 每个 `child-agent` 只分析一个游戏，只能使用本轮 Playwright 实际读取的证据，只返回结构化 JSON，不写仓库。
- `review-agent` 独立检查结构、来源、日期、变化证据和明显幻觉风险。
- 某个游戏证据不足时安全降级：保留该游戏旧事实，继续审核其他游戏，不猜测数据。
- 只有 review-agent 批准的可靠事实变化才会写入 `data/games.json`。
- GitHub Actions 只允许提交 `data/games.json`；没有变化时不创建空提交。

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

## 数据规则

- 永远保留完整 9 个游戏和现有前端字段。
- 事实变化必须有本轮真实读取的来源支持。
- `sources` 中的来源包含 `title`、`url`、`type`、`claims`、`checked_at`。
- `type` 仅使用 `official_api`、`official`、`official_community`、`secondary`。
- 未确认日期保持“预计 / 未确认”语义；前瞻日期不能冒充版本上线日期。
- 已结束卡池不能继续作为当前 UP。
- 证据不足时保留旧值，而不是让模型猜测。

详细 Agent 行为见 `AI_RUNBOOK.md`。
