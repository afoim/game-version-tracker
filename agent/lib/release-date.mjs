// Independently check model arithmetic against explicit, full-year release
// announcements. Never infer a year from publication time or use expiry dates.
export function explicitReleaseDate(version, evidence) {
  const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionTitle = new RegExp(`(?<![\\d.])${escaped}\\s*版本`);
  const dateVersion = String(version).match(/^(\d{1,2})\/(\d{1,2})\s*更新$/);
  const matches = [];
  for (const item of evidence) {
    const datedUpdate = dateVersion && new RegExp(`${dateVersion[1]}月${dateVersion[2]}日维护更新说明`).test(item.title || '');
    if (item.http_status !== 200 || !String(item.discovered_by || '').startsWith('bilibili-official:') || (!versionTitle.test(item.title || '') && !datedUpdate)) continue;
    const text = String(item.text || '');
    // A version update announcement explicitly anchors its calendar date. This
    // does not assert that servers opened at the maintenance start time.
    const update = datedUpdate
      ? text.match(/计划将于\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s+\d{2}:\d{2}\s+进行维护更新/)
      : /更新公告|版本更新维护/.test(item.title || '')
      ? (text.match(/【更新开始时间】\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+\d{2}:\d{2}（UTC\+8）/) ||
        text.match(/更新维护时间[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日\d{2}:\d{2}/))
      : null;
    const lines = text.split('\n');
    if (update) lines.push(`将于${update[1]}年${update[2]}月${update[3]}日上线`);
    for (const line of lines) {
      const m = line.match(/将于\s*(\d{4})年(\d{1,2})月(\d{1,2})日(?:正式)?(?:上线|开启)/);
      if (!m) continue;
      const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      if (datedUpdate && (Number(m[2]) !== Number(dateVersion[1]) || Number(m[3]) !== Number(dateVersion[2]))) continue;
      const time = Date.parse(`${date}T00:00:00Z`);
      if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) continue;
      matches.push({ date, url: item.url, quote: update && line === lines.at(-1) ? update[0] : line.trim() });
    }
  }
  if (new Set(matches.map(x => x.date)).size !== 1) return null;
  return matches[0];
}

export function elapsedReleaseDays(date, now = Date.now()) {
  const localDay = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  return Math.floor((Date.parse(`${localDay}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
}

export function verifiedVersionAge(version, evidence, now = Date.now()) {
  const release = explicitReleaseDate(version, evidence);
  if (!release) return null;
  const days = elapsedReleaseDays(release.date, now);
  return days >= 0 ? days : null;
}
