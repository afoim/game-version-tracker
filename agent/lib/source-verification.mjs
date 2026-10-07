const DOMAINS = {
  '原神': ['ys.mihoyo.com', 'www.miyoushe.com'],
  '崩坏：星穹铁道': ['sr.mihoyo.com', 'www.miyoushe.com'],
  '崩坏3': ['bh3.mihoyo.com', 'www.miyoushe.com'],
  '绝区零': ['zzz.mihoyo.com', 'www.miyoushe.com'],
  '鸣潮': ['mc.kurogames.com', 'wutheringwaves.kurogames.com'],
  '明日方舟：终末地': ['endfield.hypergryph.com'],
  '异环': ['yh.wanmei.com'],
  '星塔旅人（国服）': ['stellasora.yostar.cn'],
};

export function normalizedQuote(text) {
  return String(text).normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

export function allowedSource(game, raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') && DOMAINS[game]?.includes(url.hostname);
  } catch { return false; }
}

export async function fetchText(game, raw) {
  const signal = AbortSignal.timeout(20000);
  let url = raw;
  for (let i = 0; i < 4; i++) {
    if (!allowedSource(game, url)) throw Error('Source outside official allowlist');
    const response = await fetch(url, { redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      url = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok || !response.body) throw Error('Source unavailable');
    if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw Error('Source too large');
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw Error('Source too large');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const text = Buffer.concat(chunks).toString('utf8')
      .replace(/\\u([\da-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|quot|lt|gt);/g, ' ');
    return { url, text, checked_at: new Date().toISOString(), http_status: response.status };
  }
  throw Error('Too many source redirects');
}

export async function collectEndfieldRelease(version) {
  const listing = await fetchText('明日方舟：终末地', 'https://endfield.hypergryph.com/news');
  const decoded = listing.text.replace(/\\"/g, '"');
  const records = [...decoded.matchAll(/\{"cid":"(\d+)"[^}]*?"title":"([^"}]+)"/g)];
  const titleKey = version.replace(/版本/g, '').replace(/[「」\s]/g, '');
  const record = records.find(m => m[2].replace(/[「」\s]/g, '').includes(titleKey) && /版本更新说明/.test(m[2]));
  if (!record) return null;
  const page = await fetchText('明日方舟：终末地', `https://endfield.hypergryph.com/news/${record[1]}`);
  const match = page.text.match(/更新维护时间[\s\S]{0,200}?(\d{4})[/.](\d{1,2})[/.](\d{1,2})\s+\d{2}:\d{2}/);
  if (!match) return null;
  return { date: `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`, url: page.url, quote: match[0], title: record[2], checked_at: page.checked_at };
}

export async function verifySources(game, candidates, evidence) {
  const cache = new Map();
  const verified = [];
  for (const source of candidates) {
    const quote = normalizedQuote(source.quote);
    if (quote.length < 8) continue;
    // Recover a wrong model URL only when its literal quotation really occurs
    // in a separately collected official account announcement.
    const cached = evidence.find(item => normalizedQuote(item.text).includes(quote));
    if (cached) {
      verified.push({ ...source, url: cached.url, title: cached.title, text: cached.text, published_at: cached.published_at, checked_at: cached.checked_at });
      continue;
    }
    if (!allowedSource(game, source.url)) continue;
    if (!cache.has(source.url)) cache.set(source.url, fetchText(game, source.url).catch(() => null));
    const page = await cache.get(source.url);
    if (page && normalizedQuote(page.text).includes(quote)) verified.push({ ...source, ...page });
  }
  return verified;
}

export function citedReleaseDate(candidate, sources) {
  return citedDate(candidate.current_release_date, 'current_release_date', sources, true);
}

export function citedDate(date, claim, sources, maintenanceOnly = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const [year, month, day] = date.split('-').map(Number);
  for (const source of sources) {
    if (!source.claims?.includes(claim)) continue;
    const quote = source.quote;
    const dates = [...quote.matchAll(/(\d{4})[年/.\-](\d{1,2})[月/.\-](\d{1,2})日?/g)];
    if (dates.some(m => +m[1] === year && +m[2] === month && +m[3] === day)) return date;
    // Anchor a month/day maintenance announcement to its independently read
    // publication year; never infer the year from the computer's current date.
    const published = source.published_at && new Date(source.published_at);
    const matchesMonthDay = [...quote.matchAll(/(\d{1,2})月(\d{1,2})日/g)].some(m => +m[1] === month && +m[2] === day);
    if (published && published.getUTCFullYear() === year && matchesMonthDay &&
        (!maintenanceOnly || /版本.*(?:维护|更新)|(?:维护|更新).*版本/s.test(quote)) &&
        Math.abs(Date.parse(date) - published.getTime()) <= 30 * 86400000) return date;
  }
  return null;
}

export function officialVersionEnd(version, evidence) {
  const key = version.match(/\d+(?:\.\d+)+/)?.[0];
  if (!key) return null;
  for (const item of evidence) {
    if (!item.title.includes(key) || !/版本更新说明|版本更新公告|更新公告/.test(item.title)) continue;
    const match = item.text.match(/版本的持续时间为[^\n]{0,150}?[-–]\s*(\d{4})[/.](\d{1,2})[/.](\d{1,2})/)
      || item.text.match(/(?:该版本|[\d.]+版本)结束时间为\s*(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
    if (match) return { date: `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`, url: item.url, title: item.title, quote: match[0], checked_at: item.checked_at };
  }
  return null;
}

export function announcedNextDate(version, evidence) {
  const key = version.match(/\d+(?:\.\d+)+/)?.[0] || version.replace(/预计|版本|核心章节|[「」\s]/g, '');
  if (!key) return null;
  for (const item of evidence) {
    if (!item.title.replace(/[「」\s]/g, '').includes(key) || !item.published_at) continue;
    const match = item.text?.match(/版本将于(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日上线/);
    if (!match) continue;
    const year = match[1] || new Date(item.published_at).getUTCFullYear();
    const date = `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    if (!Number.isFinite(Date.parse(date)) || Math.abs(Date.parse(date) - Date.parse(item.published_at)) > 90 * 86400000) continue;
    return { date, url: item.url, title: item.title, quote: match[0], checked_at: item.checked_at };
  }
  return null;
}

export function observedCycle(evidence) {
  const releases = new Map();
  for (const item of evidence) {
    if (!/版本维护通知/.test(item.title)) continue;
    const version = item.title.match(/(\d+\.\d+)版本/)?.[1];
    const match = item.text.match(/将在(\d{1,2})月(\d{1,2})日[^\n]{0,40}进行版本更新维护/);
    if (!version || !match || !item.published_at) continue;
    const year = new Date(item.published_at).getUTCFullYear();
    const date = `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    if (Math.abs(Date.parse(date) - Date.parse(item.published_at)) > 30 * 86400000) continue;
    releases.set(version, date);
  }
  const dates = [...new Set(releases.values())].sort().slice(-3);
  if (dates.length < 3) return null;
  const intervals = dates.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dates[i])) / 86400000);
  if (intervals.some(d => d < 14 || d > 90)) return null;
  return { days: Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length), basis: `近期三个官方维护日期 ${dates.join('、')}，间隔 ${intervals.join('、')} 天，按平均周期估算` };
}
