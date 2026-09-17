import { GAME_NAMES } from './lib/validate.mjs';

function json(value) {
  return JSON.stringify(value, null, 2);
}

export function mainPlanPrompt(dataset) {
  const compact = dataset.games.map((game) => ({
    game_name: game.game_name,
    current_version: game.current_version,
    next_version: game.next_version,
    preview_status: game.preview_status,
    preview_title: game.preview_title,
    preview_start_at: game.preview_start_at,
    preview_live_url: game.preview_live_url,
    preview_replay_url: game.preview_replay_url,
    current_up_characters: game.current_up_characters,
    existing_sources: (game.sources || []).map((source) => source.url),
  }));

  return `你是 Game Version Tracker 的 main-agent。你不能修改仓库，也不能自己联网。你的职责是读取当前仓库摘要，并给 9 个 child-agent 分配独立核验命令。

当前时间：${new Date().toISOString()}
必须覆盖以下 9 个游戏且各出现一次：
${GAME_NAMES.map((name, i) => `${i + 1}. ${name}`).join('\n')}

当前仓库摘要：
${json(compact)}

对每个游戏生成 3~4 个公开网页搜索查询词，优先寻找：官方网站/官方公告/官方社区，其次可靠新闻页面。目标覆盖当前版本与更新内容、下一版本、前瞻直播、当前 UP/卡池与日期。每个游戏至少有 1 条查询专门寻找“下一版本前瞻/直播/特别节目”的官宣时间与官方直播地址；如果节目已经结束，还要继续寻找官方账号发布的录播/回放（Bilibili、YouTube 或其他官方视频平台）。查询词应包含游戏名，并尽量带下一版本号；蔚蓝档案（日服）可以使用日文的「生放送 / 公式 / 配信」等关键词。

你只负责“分配任务”，不判断最终数据，不输出固定答案，不使用模型记忆补事实。

只返回严格 JSON，不要 Markdown：
{
  "assignments": [
    {
      "game_name": "原神",
      "objective": "一句话说明该 child-agent 必须核验什么",
      "queries": ["...", "..."]
    }
  ]
}`;
}

export function childPrompt({ assignment, currentGame, evidence }) {
  const evidenceForModel = evidence.map((item) => ({
    title: item.title,
    url: item.url,
    checked_at: item.checked_at,
    discovered_by: item.discovered_by,
    http_status: item.http_status,
    text: item.text,
  }));

  return `你是 Game Version Tracker 的 child-agent，只负责一个游戏：${assignment.game_name}。
main-agent 给你的命令：${assignment.objective}

你没有仓库写权限，不允许修改文件、不允许 commit、不允许 push，也不允许自行联网。你只能分析下面由 Playwright search-worker 在本轮真实打开的网页。

当前仓库数据：
${json(currentGame)}

本轮网页证据：
${json(evidenceForModel)}

任务：核验当前版本、主要内容、下一版本、前瞻状态、前瞻标题、前瞻直播开始时间、官方直播地址、官方录播/回放地址、当前 UP/卡池，以及现有日期/剩余天数字段。只有网页证据明确支持时才改变事实；证据不足的事实字段保持原值。禁止使用模型记忆补事实，禁止猜日期，禁止把前瞻日期当版本上线日期，已经结束的卡池不能继续作为当前 UP。

前瞻字段规则：
- preview_title：官方前瞻/特别节目的标题；没有可靠标题时为 null。
- preview_start_at：官方公布的开播时间，必须写带时区的 ISO 8601，例如 2026-09-16T19:30:00+08:00；没有可靠时间时为 null。
- preview_live_url：官方直播间或官方预定直播页；没有可靠链接时为 null。
- preview_replay_url：节目结束后仍可观看的官方账号完整录播/回放；优先 Bilibili/YouTube 等官方账号视频，不能用第三方搬运或解说代替；尚未发布或无法确认时为 null。若官方 YouTube Live 原直播链接在节目结束后直接保留为可观看 VOD，可以与 preview_live_url 相同。
- preview_status=已发布 时也要继续寻找 preview_replay_url，不能只写“已发布”就结束核验。

来源规则：
- candidate.sources 只能包含上面 evidence 中本轮真实读取成功的 URL；不要保留本轮没有读到的旧来源。
- url 和 checked_at 必须逐字复制对应 evidence。
- type 只能是 official_api / official / official_community / secondary。
- claims 只写该网页实际支持的字段。
- verification_status=verified 只表示“本轮证据确实对这个游戏的当前版本/更新、下一版本/前瞻、当前 UP 中至少一个核心事实完成了有效核验”；只有打开了网页但内容无关、过旧或无法支撑任何核心事实时，也必须返回 insufficient。evidence 为空时同样必须返回 insufficient，并原样返回当前 candidate。

candidate 必须是该游戏完整对象，保留当前对象已有的全部前端字段（包括 preview_title / preview_start_at / preview_live_url / preview_replay_url），不得增加解释性字段。changed 表示除 sources/checked_at 外是否有事实变化。

只返回严格 JSON，不要 Markdown：
{
  "game_name": "${assignment.game_name}",
  "verification_status": "verified",
  "changed": false,
  "candidate": { "game_name": "${assignment.game_name}" },
  "notes": ["简短核验结论"]
}`;
}

export function reviewPrompt({ currentDataset, proposedDataset, childResults, evidenceSummary, mechanicalIssues }) {
  return `你是独立的 review-agent。你不是 main-agent，也不是 child-agent。你不能修改仓库、不能联网、不能自行补充事实。你的唯一职责是决定这一整轮候选数据是否足够可靠，只有 approved=true 时 orchestrator 才可能写入 data/games.json。

必须检查：
1. JSON/对象结构是否完整，9 个游戏是否齐全且没有重复。
2. 必填字段是否存在且类型合理。
3. 对 verification_status=verified 的 child-agent，candidate.sources 必须都对应本轮 Playwright 实际读取成功的网页；来源必须真的存在。
4. 日期是否可解析、顺序是否合理、前瞻时间是否被误写成版本上线时间、官方录播是否真来自官方账号、当前卡池是否已经明显过期、剩余天数是否明显不合理。
5. 所有事实变化是否能从对应 evidence 支持；发现明显幻觉、把推测写成确认、来源与结论不匹配时必须拒绝。
6. verification_status=insufficient 是允许的安全降级：说明 search-worker 已尝试核验但证据不足。此时该游戏必须保留 currentDataset 的旧事实，不能因为证据不足而猜测或改值；它本身不应导致整批拒绝。
7. 只有以下情况需要拒绝整批：缺少 child-agent 结果、verified 结果没有真实 evidence、insufficient 游戏却修改了旧事实、可靠变化缺少来源支持、结构/日期明显错误、或存在明显幻觉。

重要：proposedDataset 只合并“verified 且有实质事实变化”的 candidate。verified 但事实没变时，允许 proposedDataset 保留旧 sources/checked_at，从而避免每天仅因核验时间刷新就产生无意义提交。insufficient 游戏同样必须完整保留旧数据。

程序化预审发现的问题：
${json(mechanicalIssues)}

原数据：
${json(currentDataset)}

9 个 child-agent 返回：
${json(childResults)}

本轮真实 evidence 摘要：
${json(evidenceSummary)}

orchestrator 合并后的候选数据：
${json(proposedDataset)}

不要因为“看起来可能正确”就批准变化；但也不要因为某个游戏诚实返回 insufficient 就否决其他游戏的可靠更新。只要所有不确定游戏都安全保留旧事实、所有被合并的变化都有证据、结构完整且没有明显幻觉，就可以 approved=true。

只返回严格 JSON，不要 Markdown：
{
  "approved": true,
  "issues": [],
  "unsupported_claims": [],
  "summary": ["逐游戏或总体审核结论"]
}`;
}
