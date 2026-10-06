import { mkdir, writeFile } from 'node:fs/promises';
import { GAME_NAMES } from './lib/validate.mjs';
import { createLlmRunner } from './lib/opencode.mjs';
import { extractJson } from './lib/json.mjs';
import { elapsedReleaseDays } from './lib/release-date.mjs';

// Independent of Bilibili collection and publication. Eight research calls
// start together; failed games remain visible in the audit, never guessed.
const now = Date.now();
const runner = await createLlmRunner({ webResearch: true });
await mkdir('agent-output', { recursive: true });
try {
  const results = await Promise.all(GAME_NAMES.map(async game => {
    const started = Date.now();
    console.log(`[version-facts] ${game} 开始联网研究`);
    try {
      const response = await runner.run(`你正在只读研究游戏「${game}」中国大陆服务器。当前北京时间日历日期为${new Date(now + 28800000).toISOString().slice(0, 10)}。
必须使用 websearch 搜索和 webfetch 读取官方新闻/公告；不使用B站，不使用模型记忆补事实。不读取本地文件，不执行命令，不提交任何数据。
只研究三项：当前版本实际开启日期；下个版本日期；当前版本热门/重点内容（指公告重点，不编造热度排行榜）。
日期用YYYY-MM-DD。当前版本开启日期不可用客户端小补丁、预下载、卡池切换或文章发布日期代替。
下个版本有官方日期时next_release_kind=official；否则estimate，查询最近至少三个完整版本的开始日期，按相邻日期差估算正常版本周期。跳过小补丁/特殊短版本。证据不足时cycle_days=42，cycle_basis明确写用户指定默认42天。不要把预计写成官方确认。
必须提供真实已读取的来源URL和逐字quote。查不到实际开启日期时返回null，不能为避免未知编造日期。
严格JSON：{"game_name":"${game}","current_version":"版本名称","current_release_date":null,"next_release_date":null,"next_release_kind":"estimate","cycle_days":42,"cycle_basis":"依据","historical_releases":[{"version":"版本","date":"YYYY-MM-DD","url":"来源"}],"current_content":["最多五项重点"],"sources":[{"url":"官方来源","quote":"实际原文","claims":["current_release_date"]}]}`);
      const value = extractJson(response.text);
      if (value.game_name !== game || !Array.isArray(value.sources) || !Array.isArray(value.current_content)) throw Error('研究结果结构不完整');
      const officialDomains = ['mihoyo.com', 'hoyoverse.com', 'hoyolab.com', 'kurogames.com', 'gryphline.com', 'hypergryph.com', 'yh.wanmei.com', 'stellasora.yostar.cn'];
      for (const source of value.sources) {
        const url = new URL(source.url);
        if (url.protocol !== 'https:' || url.username || url.password || !officialDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw Error('研究结果使用了非官方来源');
        if (typeof source.quote !== 'string' || source.quote.length < 4 || !Array.isArray(source.claims)) throw Error('缺少原文引用');
      }
      const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
      if (value.current_release_date !== null && !validDate(value.current_release_date)) throw Error('当前版本日期无效');
      if (value.next_release_date !== null && !validDate(value.next_release_date)) throw Error('下一版本日期无效');
      if (!['official', 'estimate'].includes(value.next_release_kind)) throw Error('缺少日期性质');
      value.current_version_days = value.current_release_date ? elapsedReleaseDays(value.current_release_date, now) : null;
      if (value.current_version_days !== null && value.current_version_days < 0) throw Error('当前版本尚未开启');
      if (value.next_release_kind === 'estimate') {
        if (!Number.isInteger(value.cycle_days) || value.cycle_days < 14 || value.cycle_days > 90) throw Error('估算周期超出合理范围');
        value.next_release_date = value.current_release_date ? new Date(Date.parse(value.current_release_date) + value.cycle_days * 86400000).toISOString().slice(0, 10) : null;
      }
      return { game_name: game, status: 'needs_review', elapsed_seconds: (Date.now() - started) / 1000, candidate: value, events: response.events };
    } catch (error) {
      return { game_name: game, status: 'failed', error: String(error.message), elapsed_seconds: (Date.now() - started) / 1000 };
    }
  }));
  await writeFile('agent-output/version-facts-research.json', JSON.stringify({ checked_at: new Date().toISOString(), publication: false, results }, null, 2) + '\n');
  console.log(`[version-facts] ${results.filter(r => r.status === 'needs_review').length}/8 返回，结果仅供审核，不发布`);
  if (results.some(r => r.status === 'failed')) process.exitCode = 1;
} finally {
  await runner.close();
}
