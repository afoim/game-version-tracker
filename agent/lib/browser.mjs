import { chromium } from 'playwright';

const MAX_PAGE_TEXT = Number(process.env.AGENT_MAX_PAGE_TEXT || 7000);
const MAX_EVIDENCE = Number(process.env.AGENT_MAX_EVIDENCE || 10);
const NAV_TIMEOUT = Number(process.env.AGENT_NAV_TIMEOUT_MS || 15000);
const MAX_DYNAMIC_PAGES = Number(process.env.AGENT_MAX_DYNAMIC_PAGES || 3);

export const BILIBILI_OFFICIAL_ACCOUNTS = {
  原神: { mid: '401742377', label: '原神', slug: 'genshin' },
  '崩坏：星穹铁道': { mid: '1340190821', label: '崩坏：星穹铁道', slug: 'starrail' },
  崩坏3: { mid: '27534330', label: '崩坏3', slug: 'honkai3' },
  绝区零: { mid: '1636034895', label: '绝区零', slug: 'zzz' },
  鸣潮: { mid: '1955897084', label: '鸣潮', slug: 'wuwa' },
  '明日方舟：终末地': { mid: '1265652806', label: '明日方舟：终末地', slug: 'endfield' },
  异环: { mid: '3546636978489848', label: '异环', slug: 'yh' },
  '星塔旅人（国服）': { mid: '3546645778139206', label: '星塔旅人', slug: 'stellasora' },
};

function cleanText(value) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseCookieHeader(raw, domain) {
  if (!raw) return [];
  return String(raw)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const index = part.indexOf('=');
      if (index <= 0) return [];
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (!name) return [];
      return [{ name, value, domain, path: '/', secure: true, sameSite: 'Lax' }];
    });
}

function versionAnchors(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === '暂未公布') return [];
  const semantic = raw.match(/\b(\d+\.\d+)\b/);
  if (semantic) {
    const version = semantic[1];
    return [`${version}版本`, `version ${version}`, `v${version}`];
  }
  const fullDate = raw.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (fullDate) {
    const [, year, month, day] = fullDate;
    const mm = month.padStart(2, '0');
    const dd = day.padStart(2, '0');
    return [`${year}/${mm}/${dd}`, `${year}-${mm}-${dd}`, `${year}年${Number(month)}月${Number(day)}日`];
  }
  const shortDate = raw.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (shortDate) {
    const [, month, day] = shortDate;
    return [`${month.padStart(2, '0')}/${day.padStart(2, '0')}`, `${Number(month)}月${Number(day)}日`];
  }
  return [raw.replace(/（预计）|\(预计\)|预计/g, '').trim()].filter(Boolean);
}

function collectStrings(value, output = [], seen = new Set(), depth = 0) {
  if (depth > 9 || value === null || value === undefined) return output;
  if (typeof value === 'string') {
    const text = cleanText(value);
    if (text && text.length <= 1600 && !seen.has(text)) {
      seen.add(text);
      output.push(text);
    }
    return output;
  }
  if (typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, seen, depth + 1);
    return output;
  }
  for (const [key, item] of Object.entries(value)) {
    if (/avatar|face|garb|badge|icon|stat|like|comment|forward/i.test(key)) continue;
    collectStrings(item, output, seen, depth + 1);
  }
  return output;
}

function dynamicText(item) {
  const author = item?.modules?.module_author;
  return cleanText([
    author?.name,
    author?.pub_time,
    ...collectStrings(item?.modules?.module_dynamic),
  ].filter(Boolean).join('\n')).slice(0, MAX_PAGE_TEXT);
}

function dynamicTimestamp(item) {
  const value = Number(item?.modules?.module_author?.pub_ts || 0);
  return Number.isFinite(value) ? value : 0;
}

function previewRelated(text, currentGame) {
  if (!/前瞻|特别节目|特別番組|通讯|直播|生放送|予告番組|回放|录播|情报回顾|情報/i.test(text)) return false;
  const anchors = versionAnchors(currentGame?.next_version);
  if (!anchors.length) return false;
  const haystack = text.toLowerCase();
  return anchors.some((anchor) => haystack.includes(anchor.toLowerCase()));
}

function evidenceScore(text, currentGame, recencyIndex) {
  const lower = text.toLowerCase();
  let score = Math.max(0, 6 - recencyIndex / 3);
  for (const anchor of versionAnchors(currentGame?.next_version)) {
    if (lower.includes(anchor.toLowerCase())) score += 18;
  }
  for (const anchor of versionAnchors(currentGame?.current_version)) {
    if (lower.includes(anchor.toLowerCase())) score += 12;
  }
  for (const character of (currentGame?.current_up_characters || []).slice(0, 3)) {
    if (character && lower.includes(String(character).toLowerCase())) score += 5;
  }
  if (/前瞻|特别节目|通讯|直播|回放|录播|情报回顾/.test(text)) score += 15;
  if (/版本|更新|维护|活动|角色|调频|跃迁|祈愿|寻访|招募|卡池|up/i.test(text)) score += 8;
  return score;
}

function extractArchive(item) {
  const archive = item?.modules?.module_dynamic?.major?.archive;
  if (!archive) return null;
  const bvid = archive.bvid || JSON.stringify(archive).match(/\b(BV[0-9A-Za-z]+)\b/)?.[1];
  if (!bvid) return null;
  return {
    bvid,
    title: cleanText(archive.title || `Bilibili video ${bvid}`),
    desc: cleanText(archive.desc || ''),
  };
}

function normalizeImageUrl(raw) {
  if (!raw) return null;
  const value = typeof raw === 'string' ? raw : raw.url || raw.src || raw.image_src?.remote?.url;
  if (!value) return null;
  const absolute = value.startsWith('//') ? `https:${value}` : String(value).replace(/^http:/, 'https:');
  try {
    const url = new URL(absolute);
    if (!url.hostname.endsWith('hdslb.com')) return null;
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/@[^/]+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

function extractImages(item) {
  const major = item?.modules?.module_dynamic?.major;
  if (!major) return [];
  const urls = [];
  const seen = new Set();
  function walk(value, key = '', depth = 0) {
    if (depth > 9 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (!/pic|image|cover|src|url/i.test(key)) return;
      const normalized = normalizeImageUrl(value);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const itemValue of value) walk(itemValue, key, depth + 1);
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) walk(childValue, childKey, depth + 1);
  }
  walk(major);
  return urls.slice(0, 6);
}

function dynamicTitle(item, account) {
  const archive = extractArchive(item);
  return cleanText(
    item?.modules?.module_dynamic?.major?.opus?.title ||
      archive?.title ||
      item?.modules?.module_dynamic?.desc?.text ||
      `${account.label}官方动态`,
  ).slice(0, 180);
}

export async function createEvidenceCollector() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  });
  const bilibiliCookies = parseCookieHeader(process.env.BILIBILI_COOKIE, '.bilibili.com');
  if (bilibiliCookies.length) await context.addCookies(bilibiliCookies);

  async function captureBilibiliFeed(account) {
    const page = await context.newPage();
    const itemsById = new Map();
    const pending = new Set();
    const onResponse = (response) => {
      const task = (async () => {
        try {
          const url = new URL(response.url());
          if (!url.hostname.endsWith('bilibili.com') ||
              url.pathname !== '/x/polymer/web-dynamic/v1/feed/space' ||
              url.searchParams.get('host_mid') !== String(account.mid) ||
              response.status() >= 400) return;
          const payload = await response.json().catch(() => null);
          if (payload?.code !== 0 || !Array.isArray(payload?.data?.items)) return;
          for (const item of payload.data.items) {
            const id = String(item?.id_str || item?.id || '');
            if (id) itemsById.set(id, item);
          }
        } catch {
          // Keep other successful feed pages when one response is blocked/malformed.
        }
      })();
      pending.add(task);
      task.finally(() => pending.delete(task));
    };
    page.on('response', onResponse);
    try {
      await page.goto(`https://space.bilibili.com/${account.mid}/dynamic`, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT + 5000,
      }).catch(() => null);
      await page.waitForTimeout(1800);
      for (let index = 1; index < MAX_DYNAMIC_PAGES; index += 1) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(1200);
      }
      await Promise.allSettled([...pending]);
      if (!itemsById.size) {
        const apiUrl =
          `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${encodeURIComponent(account.mid)}` +
          '&features=itemOpusStyle';
        const response = await context.request
          .get(apiUrl, {
            timeout: NAV_TIMEOUT,
            headers: { Referer: `https://space.bilibili.com/${account.mid}/dynamic` },
          })
          .catch(() => null);
        if (response?.ok()) {
          const payload = await response.json().catch(() => null);
          if (payload?.code === 0 && Array.isArray(payload?.data?.items)) {
            for (const item of payload.data.items) {
              const id = String(item?.id_str || item?.id || '');
              if (id) itemsById.set(id, item);
            }
          }
        }
      }
      return [...itemsById.values()];
    } finally {
      page.off('response', onResponse);
      await page.close().catch(() => {});
    }
  }

  async function collectBilibiliOfficialEvidence(currentGame) {
    const account = BILIBILI_OFFICIAL_ACCOUNTS[currentGame.game_name];
    if (!account) return [];
    const items = await captureBilibiliFeed(account);
    const ranked = items
      .map((item, index) => {
        const text = dynamicText(item);
        return { item, text, score: evidenceScore(text, currentGame, index), timestamp: dynamicTimestamp(item) };
      })
      .filter((entry) => entry.text)
      .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);

    const evidence = [];
    const seenIds = new Set();
    for (const entry of ranked) {
      const item = entry.item;
      const id = String(item?.id_str || item?.id || '');
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      const archive = extractArchive(item);
      const isPreview = previewRelated(entry.text, currentGame);
      const images = extractImages(item);
      const checkedAt = new Date().toISOString();
      evidence.push({
        title: dynamicTitle(item, account),
        url: `https://www.bilibili.com/opus/${id}`,
        text: entry.text,
        http_status: 200,
        checked_at: checkedAt,
        discovered_by: `bilibili-official:${account.mid}:dynamic`,
        bilibili_dynamic_id: id,
        preview_related: isPreview,
        images,
      });
      if (archive && evidence.length < MAX_EVIDENCE) {
        evidence.push({
          title: archive.title,
          url: `https://www.bilibili.com/video/${archive.bvid}/`,
          text: cleanText(`${account.label}\n${archive.title}\n${archive.desc}\n${entry.text}`).slice(0, MAX_PAGE_TEXT),
          http_status: 200,
          checked_at: checkedAt,
          discovered_by: `bilibili-official:${account.mid}:video`,
          bilibili_dynamic_id: id,
          preview_related: isPreview,
          images: images.slice(0, 1),
        });
      }
      if (evidence.length >= MAX_EVIDENCE) break;
    }
    return evidence;
  }

  return {
    collect: (_assignment, currentGame) => collectBilibiliOfficialEvidence(currentGame),
    close: () => browser.close(),
  };
}
