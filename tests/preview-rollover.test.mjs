import test from 'node:test';
import assert from 'node:assert/strict';
import { canClearPreviousPreview } from '../agent/lib/preview-rollover.mjs';

test('clear obsolete preview only after the matching official version is released', () => {
  const current = { preview_title: '4.6版本前瞻特别节目' };
  const candidate = { current_version: '4.6', preview_status: '未官宣', preview_title: null, preview_start_at: null, preview_live_url: null, preview_replay_url: null };
  const evidence = [{ title: '4.6版本', text: '将于2026年9月28日上线', http_status: 200, discovered_by: 'bilibili-official:1340190821', url: 'https://www.bilibili.com/video/BV1wXeq6wEGR/' }];
  assert.equal(canClearPreviousPreview(current, candidate, evidence, Date.parse('2026-10-07T00:00:00Z')), true);
  assert.equal(canClearPreviousPreview(current, candidate, evidence, Date.parse('2026-09-27T00:00:00Z')), false);
  assert.equal(canClearPreviousPreview({ preview_title: '4.7版本前瞻' }, candidate, evidence), false);
  assert.equal(canClearPreviousPreview(current, candidate, []), false);
  assert.equal(canClearPreviousPreview(current, { ...candidate, preview_live_url: 'https://live.bilibili.com/1' }, evidence), false);
});
