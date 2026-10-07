import { readFile, writeFile } from 'node:fs/promises';
import { GAME_NAMES, validateDataset } from './lib/validate.mjs';
import { buildFeedGames } from './lib/media-feed.mjs';
import { elapsedReleaseDays, explicitReleaseDate } from './lib/release-date.mjs';
import { verifySources, citedReleaseDate, citedDate, collectEndfieldRelease, officialVersionEnd, observedCycle } from './lib/source-verification.mjs';

const read = async file => JSON.parse(await readFile(file, 'utf8'));
const dataset = await read('data/games.json');
const report = await read('agent-output/chatgpt-facts.json');
const audit = await read('agent-output/evidence-audit.json');
const today = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
if (report.checked_at !== today || report.results.length !== 8 || new Set(report.results.map(r => r.game_name)).size !== 8) throw Error('Incomplete or stale research');
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value;
for (const name of GAME_NAMES) {
  const result = report.results.find(r => r.game_name === name);
  if (result?.status !== 'needs_review') throw Error(`Missing final answer: ${name}`);
  const c = result.candidate;
  const verifiedSources = await verifySources(name, c.sources, audit.evidence[name] || []);
  if (!verifiedSources.length) throw Error(`No independently readable quotation: ${name}`);
  const game = dataset.games.find(g => g.game_name === name);
  const version = c.current_version.match(/\d+(?:\.\d+)+/)?.[0] || c.current_version;
  let official = explicitReleaseDate(version, audit.evidence[name] || []);
  if (!official && name === '星塔旅人（国服）' && c.current_release_date) {
    const [, month, day] = c.current_release_date.split('-');
    official = explicitReleaseDate(`${Number(month)}/${Number(day)} 更新`, audit.evidence[name] || []);
  }
  if (name === '明日方舟：终末地') official = await collectEndfieldRelease(c.current_version).catch(() => null) || official;
  // Independently read official announcements override mistaken model dates.
  const release = official?.date || citedReleaseDate(c, verifiedSources);
  if (release && (!validDate(release) || release > today)) throw Error(`Invalid current release: ${name}`);
  if (!Array.isArray(c.sources) || !c.sources.length) throw Error(`Missing sources: ${name}`);
  if (!['official', 'estimate'].includes(c.next_release_kind)) throw Error(`Missing date provenance: ${name}`);
  if (c.next_release_kind === 'estimate' && (!Number.isInteger(c.cycle_days) || c.cycle_days < 14 || c.cycle_days > 90)) throw Error(`Invalid cycle: ${name}`);
  const end = officialVersionEnd(c.current_version, audit.evidence[name] || []);
  const cycle = observedCycle(audit.evidence[name] || []);
  const cycleDays = cycle?.days || 42;
  const next = end?.date || (c.next_release_kind === 'estimate'
    ? (release ? new Date(Date.parse(release) + cycleDays * 86400000).toISOString().slice(0, 10) : null)
    : c.next_release_date);
  if (!end && c.next_release_kind === 'official' && !citedDate(c.next_release_date, 'next_release_date', verifiedSources)) throw Error(`Unverified official next date: ${name}`);
  if (next && (!validDate(next) || next <= release)) throw Error(`Invalid next release: ${name}`);
  game.current_version = c.current_version;
  game.current_release_date = release;
  game.current_version_days = release ? elapsedReleaseDays(release) : null;
  game.current_content = c.current_content;
  game.next_version = c.next_version;
  game.next_release_date = next;
  game.next_release_kind = end ? 'official' : c.next_release_kind;
  game.cycle_basis = game.next_release_kind === 'estimate' ? cycle?.basis || '缺少连续三个版本的可核验日期，使用用户指定默认42天周期估算' : '官方版本公告明确日期';
  game.days_to_next_version = next ? Math.max(0, -elapsedReleaseDays(next)) : null;
  game.facts_checked_at = new Date().toISOString();
  // Old current-version preview must not masquerade as next-version preview.
  const nextKey = c.next_version.match(/\d+(?:\.\d+)+/)?.[0] || c.next_version.replace(/预计|版本|核心章节|[「」\s]/g, '');
  const previews = (audit.evidence[name] || []).filter(s => /前瞻/.test(s.title) &&
    (s.title.replace(/[「」\s]/g, '').includes(nextKey) || s.text?.replace(/[「」\s]/g, '').includes(nextKey)));
  const replay = previews.find(s => s.url.includes('/video/') || /现已结束|回放|已发布/.test(s.title));
  game.preview_status = replay ? '已发布' : previews.length ? '已官宣' : '尚未发布';
  for (const field of ['preview_title', 'preview_start_at', 'preview_live_url', 'preview_replay_url']) game[field] = null;
  game.preview_images = [];
  if (previews.length) {
    game.preview_title = (replay || previews[0]).title;
    game.preview_replay_url = replay?.url || null;
  }
  const allowed = ['mihoyo.com', 'hoyoverse.com', 'hoyolab.com', 'kurogames.com', 'hypergryph.com', 'gryphline.com', 'wanmei.com', 'yostar.cn', 'bilibili.com'];
  game.sources = verifiedSources.map(s => {
    const url = new URL(s.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error(`Invalid source URL: ${name}`);
    const officialDomain = allowed.some(d => url.hostname === d || url.hostname.endsWith(`.${d}`));
    return { url: s.url, title: s.title, claims: s.claims, quote: s.quote, type: officialDomain ? 'official' : 'secondary', checked_at: s.checked_at };
  });
  if (official) game.sources.unshift({ title: '国服官方版本更新公告（日期交叉校验）', url: official.url, type: 'official_community', claims: ['current_release_date'], checked_at: game.facts_checked_at });
  if (end) game.sources.unshift({ ...end, type: 'official_community', claims: ['next_release_date'] });
}
validateDataset(dataset);
const feed = await read('agent-output/bili-media-feed.json');
feed.data.games = buildFeedGames(dataset.games, process.env.GAME_DATA_BASE_URL || 'https://game-version-tracker.pages.dev');
feed.generated_at = new Date().toISOString();
for (const section of feed.ui.sections) {
  if (section.component === 'game_status_grid') section.props.show_up = false;
}
await writeFile('data/games.json', JSON.stringify(dataset, null, 2) + '\n');
await writeFile('data/media-feed.json', JSON.stringify(feed, null, 2) + '\n');
console.log('Merged eight completed game searches with independent release-date checks');
