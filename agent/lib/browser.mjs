import { chromium } from 'playwright';

const MAX_PAGE_TEXT = Number(process.env.AGENT_MAX_PAGE_TEXT || 7000);
const MAX_EVIDENCE = Number(process.env.AGENT_MAX_EVIDENCE || 5);
const NAV_TIMEOUT = Number(process.env.AGENT_NAV_TIMEOUT_MS || 15000);
const MAX_EXISTING_EVIDENCE = Number(process.env.AGENT_MAX_EXISTING_EVIDENCE || 3);

function cleanText(value) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function unwrapDuckDuckGo(raw) {
  try {
    const url = new URL(raw, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    return normalizeUrl(target ? decodeURIComponent(target) : url.toString());
  } catch {
    return null;
  }
}

function allowedResult(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if ((host === 'bing.com' || host === 'www.bing.com') && parsed.pathname.startsWith('/ck/a')) {
      return true;
    }
    return ![
      'bing.com',
      'www.bing.com',
      'duckduckgo.com',
      'www.duckduckgo.com',
      'google.com',
      'www.google.com',
    ].includes(host);
  } catch {
    return false;
  }
}

function isSearchEngineUrl(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return [
      'bing.com',
      'www.bing.com',
      'duckduckgo.com',
      'www.duckduckgo.com',
      'google.com',
      'www.google.com',
    ].includes(host);
  } catch {
    return true;
  }
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function baseDomain(raw) {
  try {
    const labels = new URL(raw).hostname.toLowerCase().split('.').filter(Boolean);
    return labels.length >= 2 ? labels.slice(-2).join('.') : labels[0] || '';
  } catch {
    return '';
  }
}

function isPreviewMediaLink(raw, label = '') {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const mediaHost =
      host === 'youtu.be' ||
      host.endsWith('youtube.com') ||
      host.endsWith('bilibili.com') ||
      host.endsWith('twitch.tv');
    if (!mediaHost) return false;
    return /前瞻|直播|回放|录播|特別番組|予告番組|生放送|live|youtube|bilibili|twitch/i.test(
      `${label} ${raw}`,
    );
  } catch {
    return false;
  }
}

function youtubeVideoId(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
    if (!host.endsWith('youtube.com')) return null;
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    const parts = url.pathname.split('/').filter(Boolean);
    if (['live', 'shorts', 'embed'].includes(parts[0])) return parts[1] || null;
  } catch {
    // Ignore malformed media URLs.
  }
  return null;
}

function bilibiliBvid(raw) {
  const match = String(raw || '').match(/\b(BV[0-9A-Za-z]+)\b/i);
  return match ? match[1] : null;
}

async function fetchMediaMetadata(context, raw, discoveredBy) {
  const checkedAt = new Date().toISOString();
  const youtubeId = youtubeVideoId(raw);
  if (youtubeId) {
    try {
      const canonical = `https://www.youtube.com/watch?v=${youtubeId}`;
      const response = await context.request.get(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`,
        { timeout: NAV_TIMEOUT },
      );
      if (response.ok()) {
        const data = await response.json();
        return {
          title: cleanText(data.title || canonical),
          url: canonical,
          text: cleanText(
            JSON.stringify({
              title: data.title,
              author_name: data.author_name,
              author_url: data.author_url,
              provider_name: data.provider_name,
            }),
          ).slice(0, MAX_PAGE_TEXT),
          http_status: response.status(),
          checked_at: checkedAt,
          discovered_by: `media-oembed:${discoveredBy}`,
        };
      }
    } catch {
      // Fall through to normal page fetching.
    }
  }

  const bvid = bilibiliBvid(raw);
  if (bvid) {
    try {
      const canonical = `https://www.bilibili.com/video/${bvid}/`;
      const response = await context.request.get(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
        { timeout: NAV_TIMEOUT },
      );
      if (response.ok()) {
        const payload = await response.json();
        if (payload?.code === 0 && payload?.data) {
          const data = payload.data;
          return {
            title: cleanText(data.title || canonical),
            url: canonical,
            text: cleanText(
              JSON.stringify({
                title: data.title,
                owner: data.owner ? { mid: data.owner.mid, name: data.owner.name } : null,
                pubdate: data.pubdate,
                desc: data.desc,
                duration: data.duration,
              }),
            ).slice(0, MAX_PAGE_TEXT),
            http_status: response.status(),
            checked_at: checkedAt,
            discovered_by: `media-api:${discoveredBy}`,
          };
        }
      }
    } catch {
      // Fall through to normal page fetching.
    }
  }

  return null;
}

function gameAnchor(gameName) {
  return String(gameName).replace(/[（(].*?[）)]/g, '').trim().toLowerCase();
}

function looksBlocked(text) {
  const blockText = text.slice(0, 1200).toLowerCase();
  return (
    blockText.includes('access denied') ||
    blockText.includes('verify you are human') ||
    blockText.includes('captcha') ||
    blockText.includes('请求被拒绝') ||
    blockText.includes('访问被拒绝')
  );
}

function stripHtml(raw) {
  return cleanText(
    String(raw ?? '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function versionAnchors(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === '暂未公布') return [];

  const semantic = raw.match(/\b(\d+\.\d+)\b/);
  if (semantic) {
    const version = semantic[1];
    return [`${version}版本`, `version ${version}`, `version ${version}`, `v${version}`];
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

function searchQueryAnchors(discoveredBy) {
  const prefix = 'search:';
  const value = String(discoveredBy || '');
  if (!value.startsWith(prefix)) return [];
  const query = value.slice(prefix.length);
  return query
    .split(/\s+/)
    .map((token) => token.replace(/["'“”‘’]/g, '').trim().toLowerCase())
    .filter((token) => {
      if (!token || token.startsWith('site:')) return false;
      if (/^\d+(?:[./-]\d+)*$/.test(token)) return false;
      if (['版本', '公告', '更新', '活动', '当前', '官方', 'news', 'update', 'jp'].includes(token)) return false;
      return token.length >= 4;
    });
}

function isRelevantSearchEvidence(item, assignment, knownDomains, currentGame) {
  if (!item) return false;
  if (knownDomains.has(baseDomain(item.url))) return true;

  const haystack = `${item.title}\n${item.url}\n${item.text.slice(0, 3500)}`.toLowerCase();
  const strongAnchors = [
    gameAnchor(assignment.game_name),
    ...versionAnchors(currentGame?.current_version),
    ...versionAnchors(currentGame?.next_version),
    ...(currentGame?.current_up_characters || []).slice(0, 2).map((value) => String(value).toLowerCase()),
  ].filter((value) => value && value !== '暂未公布');
  if (strongAnchors.some((anchor) => anchor && haystack.includes(anchor))) return true;

  const queryAnchors = searchQueryAnchors(item.discovered_by);
  const queryMatches = queryAnchors.filter((anchor) => haystack.includes(anchor)).length;
  return queryAnchors.length === 1 ? queryMatches === 1 : queryMatches >= 2;
}

function evidenceScore(item, assignment, currentGame, seedUrl = '') {
  const haystack = `${item.title}\n${item.url}\n${item.text}`.toLowerCase();
  let score = 0;
  const terms = [
    [gameAnchor(assignment.game_name), 7],
    ...versionAnchors(currentGame?.current_version).map((term) => [term, 5]),
    ...versionAnchors(currentGame?.next_version).map((term) => [term, 5]),
    ...((currentGame?.current_up_characters || []).slice(0, 2).map((value) => [String(value).toLowerCase(), 3])),
  ];
  for (const [term, weight] of terms) {
    if (term && term !== '暂未公布' && haystack.includes(term)) score += weight;
  }
  if (/news|notice|content|article|info|api/i.test(item.url)) score += 2;
  if (seedUrl && baseDomain(item.url) === baseDomain(seedUrl)) score += 3;
  if (/apm|analytics|telemetry|settings|getextlist|logger/i.test(item.url)) score -= 8;
  return score;
}

async function searchBingRss(context, query) {
  const response = await context.request.get(
    `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
    { timeout: NAV_TIMEOUT },
  );
  if (!response.ok()) return [];
  const xml = await response.text();
  const rows = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = decodeXml(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
    const url = normalizeUrl(decodeXml(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]));
    if (url && allowedResult(url)) rows.push({ title, url });
    if (rows.length >= 8) break;
  }
  return rows;
}

async function searchBing(page, query) {
  await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: NAV_TIMEOUT,
  });
  const rows = await page.locator('li.b_algo h2 a').evaluateAll((nodes) =>
    nodes.slice(0, 8).map((node) => ({ title: node.textContent || '', url: node.href || '' })),
  );
  return rows
    .map((row) => ({ ...row, url: normalizeUrl(row.url) }))
    .filter((row) => row.url && allowedResult(row.url));
}

async function searchDuckDuckGo(page, query) {
  await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: NAV_TIMEOUT,
  });
  const rows = await page.locator('a.result__a').evaluateAll((nodes) =>
    nodes.slice(0, 8).map((node) => ({ title: node.textContent || '', url: node.getAttribute('href') || '' })),
  );
  return rows
    .map((row) => ({ ...row, url: unwrapDuckDuckGo(row.url) }))
    .filter((row) => row.url && allowedResult(row.url));
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

export async function createEvidenceCollector() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'zh-CN',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  });

  const bilibiliCookies = parseCookieHeader(process.env.BILIBILI_COOKIE, '.bilibili.com');
  if (bilibiliCookies.length) {
    await context.addCookies(bilibiliCookies);
  }

  async function search(query) {
    const page = await context.newPage();
    try {
      try {
        const results = await searchBingRss(context, query);
        if (results.length) return results;
      } catch {
        // Fall through to browser-rendered search surfaces.
      }
      try {
        const results = await searchBing(page, query);
        if (results.length) return results;
      } catch {
        // Fall through to DuckDuckGo.
      }
      return await searchDuckDuckGo(page, query);
    } catch {
      return [];
    } finally {
      await page.close().catch(() => {});
    }
  }

  async function fetchPage(url, discoveredBy = 'direct', relevance = null) {
    const mediaMetadata = await fetchMediaMetadata(context, url, discoveredBy);
    if (mediaMetadata) return [mediaMetadata];

    const page = await context.newPage();
    const networkCandidates = [];
    const pendingNetworkReads = new Set();

    const onResponse = (response) => {
      const task = (async () => {
        try {
          if (response.status() >= 400) return;
          const resourceType = response.request().resourceType();
          const contentType = response.headers()['content-type'] || '';
          if (!['xhr', 'fetch'].includes(resourceType) && !contentType.includes('json')) return;
          if (!contentType.includes('json')) return;

          const responseUrl = normalizeUrl(response.url());
          if (!responseUrl || isSearchEngineUrl(responseUrl)) return;
          const raw = await response.text();
          const text = cleanText(raw);
          if (text.length < 80 || looksBlocked(text)) return;

          const item = {
            title: `Network JSON from ${responseUrl}`,
            url: responseUrl,
            text: text.slice(0, MAX_PAGE_TEXT),
            http_status: response.status(),
            checked_at: new Date().toISOString(),
            discovered_by: `network:${discoveredBy}`,
          };
          if (relevance) {
            const score = evidenceScore(item, relevance.assignment, relevance.currentGame, url);
            const trustedSeed = relevance.authoritativeDomains?.has(baseDomain(url));
            const haystack = `${item.title}\n${item.url}\n${item.text}`.toLowerCase();
            const identityTerms = [
              gameAnchor(relevance.assignment.game_name),
              ...(relevance.currentGame?.current_up_characters || [])
                .slice(0, 2)
                .map((value) => String(value).toLowerCase()),
            ].filter(Boolean);
            const versionTerms = [
              ...versionAnchors(relevance.currentGame?.current_version),
              ...versionAnchors(relevance.currentGame?.next_version),
            ];
            const semanticMatch = [...identityTerms, ...versionTerms].some(
              (term) => term && haystack.includes(term),
            );
            if (!semanticMatch || score < (trustedSeed ? 5 : 6)) return;
          }
          networkCandidates.push(item);
        } catch {
          // Network-response evidence is opportunistic; page evidence still works.
        }
      })();
      pendingNetworkReads.add(task);
      task.finally(() => pendingNetworkReads.delete(task));
    };

    page.on('response', onResponse);
    try {
      const items = [];
      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT,
        });
        await page
          .waitForFunction(() => (document.body?.innerText || '').trim().length >= 80, null, { timeout: 5000 })
          .catch(() => {});
        await page.waitForTimeout(1000);
        await Promise.allSettled([...pendingNetworkReads]);
        const status = response?.status() ?? null;
        const title = cleanText(await page.title());
        const text = cleanText(await page.locator('body').innerText({ timeout: 5000 }).catch(() => ''));
        const finalUrl = normalizeUrl(page.url()) || normalizeUrl(url);
        const links = await page
          .locator('a[href]')
          .evaluateAll((nodes) =>
            nodes
              .map((node) => ({ text: (node.textContent || '').trim(), url: node.href || '' }))
              .filter((item) => item.url),
          )
          .catch(() => []);
        if (
          finalUrl &&
          !isSearchEngineUrl(finalUrl) &&
          text.length >= 80 &&
          !looksBlocked(text) &&
          (status === null || status < 400)
        ) {
          items.push({
            title: title || finalUrl,
            url: finalUrl,
            text: text.slice(0, MAX_PAGE_TEXT),
            http_status: status,
            checked_at: new Date().toISOString(),
            discovered_by: discoveredBy,
            _links: links,
          });
        }
      } catch {
        // Try Playwright's APIRequestContext below.
      }

      const bestNetwork = networkCandidates
        .filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index)
        .sort(
          (a, b) =>
            evidenceScore(b, relevance?.assignment || { game_name: '' }, relevance?.currentGame || {}, url) -
            evidenceScore(a, relevance?.assignment || { game_name: '' }, relevance?.currentGame || {}, url),
        )
        .slice(0, 3);
      items.unshift(...bestNetwork);
      if (items.length) return items;

      try {
        const response = await context.request.get(url, { timeout: NAV_TIMEOUT });
        const status = response.status();
        if (status >= 400) return [];
        const raw = await response.text();
        const contentType = response.headers()['content-type'] || '';
        const text = contentType.includes('text/html') ? stripHtml(raw) : cleanText(raw);
        const finalUrl = normalizeUrl(response.url()) || normalizeUrl(url);
        if (!finalUrl || isSearchEngineUrl(finalUrl) || text.length < 80 || looksBlocked(text)) return [];
        return [{
          title: finalUrl,
          url: finalUrl,
          text: text.slice(0, MAX_PAGE_TEXT),
          http_status: status,
          checked_at: new Date().toISOString(),
          discovered_by: `${discoveredBy}:request-fallback`,
        }];
      } catch {
        return [];
      }
    } finally {
      page.off('response', onResponse);
      await page.close().catch(() => {});
    }
  }

  async function collect(assignment, currentGame) {
    const seen = new Set();
    const evidence = [];
    const discoveredLinks = [];
    const knownDomains = new Set(
      (currentGame.sources || [])
        .filter((source) => source?.url && ['official', 'official_api'].includes(source.type))
        .map((source) => baseDomain(source.url))
        .filter(Boolean),
    );

    async function addEvidence(candidate, requireRelevant = false) {
      const normalized = normalizeUrl(candidate.url);
      if (!normalized || seen.has(normalized) || evidence.length >= MAX_EVIDENCE) return;
      seen.add(normalized);
      const items = await fetchPage(normalized, candidate.discoveredBy, {
        assignment,
        currentGame,
        authoritativeDomains: knownDomains,
      });
      for (const item of items) {
        const sourceLooksOfficial =
          knownDomains.has(baseDomain(item.url)) || /官方|官网|official|公式/i.test(item.title || '');
        if (sourceLooksOfficial) {
          for (const link of item._links || []) {
            const linkUrl = normalizeUrl(link.url);
            if (!linkUrl || isSearchEngineUrl(linkUrl)) continue;
            const sameSite = baseDomain(linkUrl) === baseDomain(item.url);
            const previewMedia = isPreviewMediaLink(linkUrl, link.text || '');
            if (!sameSite && !previewMedia) continue;
            if (
              sameSite &&
              !/news|notice|article|detail|info|event|公告|版本|更新|前瞻|直播|お知らせ|生放送|予告/i.test(
                `${link.text || ''} ${linkUrl}`,
              )
            ) {
              continue;
            }
            discoveredLinks.push({
              url: linkUrl,
              discoveredBy: `page-link:${item.url}`,
            });
          }
        }

        const cleanItem = { ...item };
        delete cleanItem._links;
        if (evidence.some((existing) => existing.url === cleanItem.url)) continue;
        if (requireRelevant && !isRelevantSearchEvidence(cleanItem, assignment, knownDomains, currentGame)) continue;
        evidence.push(cleanItem);
        if (evidence.length >= MAX_EVIDENCE) break;
      }
    }

    for (const source of (currentGame.sources || []).slice(0, MAX_EXISTING_EVIDENCE)) {
      if (source?.url) await addEvidence({ url: source.url, discoveredBy: 'existing_source' });
    }

    const currentVersion = String(currentGame.current_version || '').replace(/[^\p{L}\p{N}./:-]+/gu, ' ').trim();
    const nextVersion = String(currentGame.next_version || '').replace(/[^\p{L}\p{N}./:-]+/gu, ' ').trim();
    const domainQueries = [...knownDomains]
      .slice(0, 2)
      .map((domain) => `site:${domain} ${assignment.game_name} ${currentVersion}`.trim());
    const youtubeNames = {
      原神: 'Genshin Impact',
      '崩坏：星穹铁道': 'Honkai Star Rail',
      崩坏3: 'Honkai Impact 3rd',
      绝区零: 'Zenless Zone Zero',
      鸣潮: 'Wuthering Waves',
      '明日方舟：终末地': 'Arknights Endfield',
      异环: 'NTE',
      '蔚蓝档案（日服）': 'Blue Archive',
      '星塔旅人（国服）': 'Stella Sora',
    };
    const youtubeName = youtubeNames[assignment.game_name] || assignment.game_name;
    const previewQueries = assignment.game_name.includes('蔚蓝档案')
      ? [
          `ブルーアーカイブ ${nextVersion} 生放送 公式 配信日時`,
          `site:youtube.com ${youtubeName} ${nextVersion} 生放送 公式`,
          `site:youtube.com ${youtubeName} ${nextVersion} livestream official`,
        ]
      : [
          `${assignment.game_name} ${nextVersion} 前瞻 直播 开播时间 官方`,
          `site:bilibili.com/video ${assignment.game_name} ${nextVersion} 前瞻 官方`,
          `site:youtube.com ${youtubeName} ${nextVersion} preview livestream 予告番組 official`,
        ];
    const queries = [
      ...previewQueries,
      ...domainQueries.slice(0, 1),
      ...(assignment.queries || []),
      ...domainQueries.slice(1),
    ].slice(0, 5);
    const searchGroups = await Promise.all(
      queries.map(async (query) => ({ query, results: await search(query) })),
    );

    for (let rank = 0; rank < 4 && evidence.length < MAX_EVIDENCE; rank += 1) {
      for (const group of searchGroups) {
        const result = group.results[rank];
        if (!result) continue;
        await addEvidence({ url: result.url, discoveredBy: `search:${group.query}` }, true);
        if (evidence.length >= MAX_EVIDENCE) break;
      }
    }

    for (const candidate of discoveredLinks.slice(0, 8)) {
      if (evidence.length >= MAX_EVIDENCE) break;
      await addEvidence(candidate, true);
    }

    if (evidence.length < 3) {
      const officialHosts = new Set();
      for (const source of currentGame.sources || []) {
        if (!source?.url || !['official', 'official_api'].includes(source.type)) continue;
        try {
          officialHosts.add(new URL(source.url).hostname.toLowerCase());
        } catch {
          // Ignore malformed legacy sources; dataset validation handles them.
        }
      }

      for (const item of evidence) {
        if (!/官方|官网|official|公式/i.test(item.title || '')) continue;
        try {
          officialHosts.add(new URL(item.url).hostname.toLowerCase());
        } catch {
          // Ignore malformed evidence URLs.
        }
      }

      const fallbackUrls = [];
      for (const host of officialHosts) {
        const domain = baseDomain(`https://${host}/`);
        for (const originHost of new Set([host, domain, `www.${domain}`])) {
          if (!originHost) continue;
          fallbackUrls.push(
            `https://${originHost}/news`,
            `https://${originHost}/main/news`,
            `https://${originHost}/m/news`,
            `https://${originHost}/`,
          );
        }
      }

      for (const url of fallbackUrls) {
        if (evidence.length >= 3) break;
        await addEvidence({ url, discoveredBy: 'official-route-fallback' }, false);
      }

      for (const candidate of discoveredLinks.slice(0, 16)) {
        if (evidence.length >= MAX_EVIDENCE) break;
        await addEvidence(candidate, true);
      }
    }

    return evidence;
  }

  return {
    collect,
    close: () => browser.close(),
  };
}
