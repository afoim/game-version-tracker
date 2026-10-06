// Independently check model arithmetic against explicit, full-year release
// announcements. Never infer a year from publication time or use expiry dates.
export function explicitReleaseDate(version, evidence) {
  const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionTitle = new RegExp(`(?<![\\d.])${escaped}\\s*版本`);
  const matches = [];
  for (const item of evidence) {
    if (item.http_status !== 200 || !String(item.discovered_by || '').startsWith('bilibili-official:') || !versionTitle.test(item.title || '')) continue;
    for (const line of String(item.text || '').split('\n')) {
      const m = line.match(/将于\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:正式)?(?:上线|开启)/);
      if (!m) continue;
      const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      const time = Date.parse(`${date}T00:00:00Z`);
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) continue;
      matches.push({ date, url: item.url, quote: line.trim() });
    }
  }
  if (new Set(matches.map(x => x.date)).size !== 1) return null;
  return matches[0];
}

export function elapsedReleaseDays(date, now = Date.now()) {
  const localDay = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  return Math.floor((Date.parse(`${localDay}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
}
