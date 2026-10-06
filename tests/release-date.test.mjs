import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitReleaseDate, elapsedReleaseDays } from '../agent/lib/release-date.mjs';

test('release arithmetic uses China calendar and rejects expiry dates and conflicting releases', () => {
  const e = { title: '4.6版本前瞻', text: '4.6版本将于2026年9月28日上线。\n兑换码于2026年9月21日失效', url: 'https://www.bilibili.com/video/BV1wXeq6wEGR/', http_status: 200, discovered_by: 'bilibili-official:1340190821:video' };
  assert.equal(explicitReleaseDate('4.6', [e]).date, '2026-09-28');
  assert.equal(elapsedReleaseDays('2026-09-28', Date.parse('2026-10-07T06:00:00+08:00')), 9);
  assert.equal(explicitReleaseDate('4.7', [e]), null);
  assert.equal(explicitReleaseDate('4.6', [{ ...e, text: '兑换码于2026年9月21日失效' }]), null);
  assert.equal(explicitReleaseDate('4.6', [e, { ...e, text: '将于2026年9月29日上线' }]), null);
});
