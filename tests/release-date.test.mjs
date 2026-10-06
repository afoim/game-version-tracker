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

test('official version maintenance anchors the calendar day, not an invented opening clock', () => {
  const e = { title: '3.2版本更新公告', text: '【更新开始时间】\n2026/09/09 06:00（UTC+8）\n预计5个小时完成。\n版本结束2026/10/21 06:00', url: 'https://www.bilibili.com/opus/1245841180737929286', http_status: 200, discovered_by: 'bilibili-official:1636034895' };
  const release = explicitReleaseDate('3.2', [e]);
  assert.equal(release.date, '2026-09-09');
  assert.ok(e.text.includes(release.quote));
  assert.equal(elapsedReleaseDays(release.date, Date.parse('2026-10-07T06:00:00+08:00')), 28);
  assert.equal(explicitReleaseDate('3.2', [{ ...e, title: '3.2版本补偿说明' }]), null);
  const wuwa = { ...e, title: '《鸣潮》3.7版本更新维护预告', text: '✦更新维护时间：2026年9月30日04:00 ~ 2026年9月30日11:00（UTC+8）\n✦预下载开启时间：2026年9月28日10:00（UTC+8）' };
  assert.equal(explicitReleaseDate('3.7', [wuwa]).date, '2026-09-30');
  assert.equal(elapsedReleaseDays('2026-09-30', Date.parse('2026-10-07T06:00:00+08:00')), 7);
});
