# 本地小时更新

生产执行入口是绘图机 `/root/game-version-tracker/agent/local-run.py --publish`，不是 GitHub Actions。旧工作流保持 disabled_manually。

1. 工作树必须干净，快进拉取 master；文件锁防止重叠。
2. 独立 B 站批次只读固定官方账号，收集动态、视频和真实正文。缓存按 URL 合并，空采集不删除历史资料或媒体。缓存保留来源实际读取时间，不冒充重新核验。
3. 八个线程各建立全新 ChatGPT 会话，一款游戏一个会话。复用 `/root/oai-image` 的账号与网络搜索传输，仅读取完成的可见最终消息；分析消息、工具消息、稳定但尚未完成的回答和超时残稿不接受。
4. 解析严格 JSON，逐字引用须在独立采集正文或重新读取的官方页面中找到。官方网页请求限制各游戏域名、重定向、大小和超时。
5. 当前版本日期按官方完整日期，或公告明确月日及其实际发布时间的年份核对。版本天数按北京时间日历重新计算，不能拿预下载或卡池日期代替。官方已写版本结束日期时优先采用；否则近期三个明确维护日期计算周期，证据不足默认42天，始终标为预计。
6. 前瞻来自下一版本的官方 B 站公告/回放，不能把当前版本前瞻带过去。UI 不显示未维护的当期 UP 信息。
7. 八份结果通过结构、来源和日期校验后，更新兼容 schema v2 的 games/feed。只提交 data/games.json、data/media-feed.json、data/media。失败不推送，保留审核日志；发布模式从干净目录启动，失败时撤销本轮数据改动。

## 部署

安装 Node 22、npm依赖和 Playwright Chromium。ChatGPT 桥接凭据在内存中读取现有 Supervisor 进程环境，不写 Git、日志或报告。仓库专用可写 deploy key 位于 `/root/.ssh/game-version-tracker-deploy`，只能访问本仓。

首次验证用 `python3 agent/local-run.py`，只写本机候选，不推送。确认结果后切到 master 并安装 ops 中 service/timer，再启用 `systemctl enable --now game-version-tracker.timer`。`OnCalendar=hourly` 每小时一次，service 50分钟超时；不重启其他业务。

可选 B 站 Cookie 放 `.agent-runtime/local.env`，chmod600，格式 BILIBILI_COOKIE=...，不提交。无 Cookie 可能遇到412/-352；只保留真实旧资料，不伪造新采集成功。

检查 `systemctl list-timers game-version-tracker.timer`、`journalctl -u game-version-tracker.service` 和 agent-output。停用用 `systemctl disable --now game-version-tracker.timer`。

## 前端契约

保留原有字段，新增 current_release_date、next_release_date、next_release_kind、cycle_basis、facts_checked_at。next_release_kind=estimate 显示“预计距离更新”，附日期与估算依据；官方日期保持“距离更新”。旧 feed 缺字段仍可显示。原始天数未知仍为 null，不能填0。推送 master 由内容托管平台发布，不使用手动部署。

## 检查

`npm test`；`python3 tests/chatgpt-final.test.py`；`npm run validate`。真实运行后必须复核八个游戏的日期和当前内容，并从主站游戏资讯页面检查桌面和手机的显示，健康检查或 JSON 合法不代表已完成内容复核。

实测（2026-10-07）：生产 oneshot 于08:20成功，八个独立会话最终答案、8款游戏、29条媒体，提交4caca8e已由绘图机专用密钥推送并自动发布到Pages；CDN generated_at=2026-10-07T00:20:21.054Z。整轮6分41秒，峰值内存642.9MiB。主站生产页面桌面及390px手机显示与发布数据一致。31项Node回归、7项Python回归通过；小时timer enabled/active，两条Actions disabled_manually。有限实跑不保证未来上游可用性；失败保留旧发布数据。会话读取429使用递增退避，桥接账号池只读，不回写生图账号快照。
