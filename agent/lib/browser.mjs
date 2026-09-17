import { chromium } from 'playwright';

const MAX_PAGE_TEXT = Number(process.env.AGENT_MAX_PAGE_TEXT || 7000);
const MAX_EVIDENCE = Number(process.env.AGENT_MAX_EVIDENCE || 5);
const NAV_TIMEOUT = Number(process.env.AGENT_NAV_TIMEOUT_MS || 15000);
const MAX_EXISTING_EVIDENCE = Number(process.env.AGENT_MAX_EXISTING_EVIDENCE || 2);

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

export async function createEvidenceCollector() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'zh-CN',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  });

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

  async function fetchPage(url, discoveredBy = 'direct') {
    const page = await context.newPage();
    try {
      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT,
        });
        await page
          .waitForFunction(() => (document.body?.innerText || '').trim().length >= 80, null, { timeout: 5000 })
          .catch(() => {});
        const status = response?.status() ?? null;
        const title = cleanText(await page.title());
        const text = cleanText(await page.locator('body').innerText({ timeout: 5000 }).catch(() => ''));
        const finalUrl = normalizeUrl(page.url()) || normalizeUrl(url);
        if (
          finalUrl &&
          !isSearchEngineUrl(finalUrl) &&
          text.length >= 80 &&
          !looksBlocked(text) &&
          (status === null || status < 400)
        ) {
          return {
            title: title || finalUrl,
            url: finalUrl,
            text: text.slice(0, MAX_PAGE_TEXT),
            http_status: status,
            checked_at: new Date().toISOString(),
            discovered_by: discoveredBy,
          };
        }
      } catch {
        // Try Playwright's APIRequestContext below.
      }

      try {
        const response = await context.request.get(url, { timeout: NAV_TIMEOUT });
        const status = response.status();
        if (status >= 400) return null;
        const raw = await response.text();
        const contentType = response.headers()['content-type'] || '';
        const text = contentType.includes('text/html') ? stripHtml(raw) : cleanText(raw);
        const finalUrl = normalizeUrl(response.url()) || normalizeUrl(url);
        if (!finalUrl || isSearchEngineUrl(finalUrl) || text.length < 80 || looksBlocked(text)) return null;
        return {
          title: finalUrl,
          url: finalUrl,
          text: text.slice(0, MAX_PAGE_TEXT),
          http_status: status,
          checked_at: new Date().toISOString(),
          discovered_by: `${discoveredBy}:request-fallback`,
        };
      } catch {
        return null;
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  async function collect(assignment, currentGame) {
    const seen = new Set();
    const evidence = [];

    async function addEvidence(candidate) {
      const normalized = normalizeUrl(candidate.url);
      if (!normalized || seen.has(normalized) || evidence.length >= MAX_EVIDENCE) return;
      seen.add(normalized);
      const item = await fetchPage(normalized, candidate.discoveredBy);
      if (item) evidence.push(item);
    }

    for (const source of (currentGame.sources || []).slice(0, MAX_EXISTING_EVIDENCE)) {
      if (source?.url) await addEvidence({ url: source.url, discoveredBy: 'existing_source' });
    }

    const queries = (assignment.queries || []).slice(0, 3);
    const searchGroups = await Promise.all(
      queries.map(async (query) => ({ query, results: await search(query) })),
    );

    for (let rank = 0; rank < 3 && evidence.length < MAX_EVIDENCE; rank += 1) {
      for (const group of searchGroups) {
        const result = group.results[rank];
        if (!result) continue;
        await addEvidence({ url: result.url, discoveredBy: `search:${group.query}` });
        if (evidence.length >= MAX_EVIDENCE) break;
      }
    }

    return evidence;
  }

  return {
    collect,
    close: () => browser.close(),
  };
}
