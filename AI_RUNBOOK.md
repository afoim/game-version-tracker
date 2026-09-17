# ChatGPT Scheduled Maintenance Runbook

本仓库采用**纯 AI 驱动维护**。唯一维护执行者是 ChatGPT 定时任务，唯一仓库操作方式是 ChatGPT 自带 GitHub 连接器。

仓库**故意不包含** Python tracker、collector、adapter、tests 或 GitHub Actions。未来维护任务不得重新引入这些旧链路，除非用户明确要求改变架构。

禁止依赖 AgentDock、用户电脑、本地路径、git CLI、本地 clone、服务器常驻进程或其他外部执行环境。

## Mission

直接维护 `data/games.json`，保证 9 个游戏的数据准确、完整、可追溯，并保持现有前端字段向后兼容。

支持游戏：

- 原神
- 崩坏：星穹铁道
- 崩坏3
- 绝区零
- 鸣潮
- 明日方舟：终末地
- 异环
- 蔚蓝档案（日服）
- 星塔旅人（国服）

## 每轮执行流程

1. 使用 GitHub 连接器重新读取默认分支最新状态，至少读取 `README.md`、`AI_RUNBOOK.md`、`data/games.json`，并记录当前 HEAD。禁止使用旧缓存直接写回。
2. 联网独立核验全部 9 个游戏。每个游戏至少检查：
   - 当前版本；
   - 当前版本实际开始时间；
   - 下一版本；
   - 下一版本上线时间或预计时间；
   - 前瞻/直播状态；
   - 当前版本主要内容；
   - 当前 UP / 卡池角色；
   - 卡池开始时间；
   - 卡池结束时间。
3. 信源优先级：官方 API / 官网 > 官方公告 / 官方社区 > 官方认证账号 > 可靠二级来源。不得使用社区猜测覆盖官方信息。
4. 直接修改 `data/games.json`。不要寻找或运行 collector，因为仓库不存在 collector。
5. 每个游戏维护 `sources` 数组。每条来源必须包含：
   - `title`；
   - 非空 `url`；
   - `type`：`official_api`、`official`、`official_community`、`secondary` 之一；
   - 非空 `claims`；
   - 可解析的 ISO 8601 `checked_at`。
6. 只记录本轮真正用于核验的 URL；同一 URL 不重复。某个来源本轮没有成功核验时，不要刷新它的 `checked_at` 来伪装为已验证。
7. 根据已核实日期重新计算天数类字段；天数不得为负。日期跨日、跨月、跨年和时区必须按来源所在地/服务器语义处理。
8. 重点防止以下错误：
   - `3.9` 与 `3.10` 按字符串错误排序；
   - 前瞻版本覆盖当前版本；
   - 直播日期被当作上线日期；
   - 卡池已结束仍显示当前角色；
   - 已进入第二期却继续显示第一期角色；
   - 未官宣版本被历史周期标成“确认”；
   - 旧版本日期被复用于新版本；
   - WAF / 429 / 临时网络错误导致错误清空数据；
   - 某一游戏核验失败后把完整 JSON 覆盖为残缺数据。
9. 如果某个游戏本轮无法获得足够可靠的新证据：保留它上一次已验证的数据和原有来源，不要编造，也不要假装本轮已核验成功；在最终报告中明确说明。
10. 提交前做逻辑验证：
    - `games` 中恰好有 9 个目标游戏；
    - 原有前端字段全部保留；
    - 每个游戏都有合法 `sources`；
    - URL 非空；
    - ISO 日期可解析；
    - 天数不为负；
    - 已结束卡池不伪装成进行中；
    - 当前版本不会被未来前瞻覆盖；
    - 预计时间与官方确认时间语义明确区分。
11. 写入前再次读取默认分支 HEAD 与 `data/games.json`。如果远端在本轮过程中发生变化，只整合兼容修改；不得 force push，不得覆盖无关并行改动。
12. 仅在存在实质变化时通过 GitHub 连接器提交并推送。通常只需要改 `data/games.json`；只有维护规则本身变化时才修改文档。
13. 最终报告必须包含：9 个游戏逐项核验结果、主要信源、修改内容、未确认项、commit hash 和 push 状态。

## 数据契约

每个游戏继续保留现有前端字段，包括但不限于：

- `game_name`
- `current_version`
- `current_content`
- `current_version_days`
- `next_version`
- `next_content`
- `preview_status`
- `days_to_next_version`
- `current_up_characters`
- `current_up_start_at`
- `current_up_end_at`
- `current_up_days_remaining`
- `sources`

`sources` 是正式数据契约的一部分，不得静默删除。

## 架构约束

以下目录/文件在纯 AI 架构中不应存在：

- `src/`
- `tests/`
- `.github/workflows/`
- Python tracker / adapter / parser

不要因为“需要验证”而自动重建它们。验证由 AI 对数据结构、日期、来源和 GitHub diff 的直接检查完成。
