import { explicitReleaseDate, elapsedReleaseDays } from './release-date.mjs';

// Clearing an obsolete preview is supported by the version's actual release,
// not by a nonexistent announcement that says no new preview exists.
export function canClearPreviousPreview(current, candidate, evidence, now = Date.now()) {
  if (!current.preview_title || !candidate.current_version) return false;
  const version = String(candidate.current_version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`(?<![\\d.])${version}(?![\\d.])`).test(current.preview_title)) return false;
  if (candidate.preview_status !== '未官宣' ||
      ['preview_title', 'preview_start_at', 'preview_live_url', 'preview_replay_url'].some(key => candidate[key] !== null)) return false;
  const release = explicitReleaseDate(candidate.current_version, evidence);
  return Boolean(release && elapsedReleaseDays(release.date, now) >= 0);
}
