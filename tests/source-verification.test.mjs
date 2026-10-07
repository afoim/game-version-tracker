import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedSource, verifySources, citedReleaseDate, citedDate, observedCycle, officialVersionEnd } from '../agent/lib/source-verification.mjs';

test('official next date must occur in the verified quotation', () => {
  const sources = [{ quote: '新版本将于2026年10月15日上线', claims: ['next_release_date'] }];
  assert.equal(citedDate('2026-10-15', 'next_release_date', sources), '2026-10-15');
  assert.equal(citedDate('2026-10-16', 'next_release_date', sources), null);
  assert.equal(citedDate(null, 'next_release_date', sources), null);
});

test('source verification rejects other games, lookalikes and unsafe URLs', () => {
  assert.equal(allowedSource('鸣潮', 'https://mc.kurogames.com/main'), true);
  for (const url of ['https://mc.kurogames.com.evil.test', 'https://ys.mihoyo.com', 'http://mc.kurogames.com', 'https://secret@mc.kurogames.com', 'https://mc.kurogames.com:1234']) assert.equal(allowedSource('鸣潮', url), false);
});

test('fabricated quotations are discarded; real quote recovers a wrong URL', async () => {
  const evidence = [{ title: '官方更新公告', url: 'https://www.bilibili.com/opus/1', text: '维护时间：2026年9月30日04:00开始更新', published_at: '2026-09-28T01:00:00Z', checked_at: '2026-10-07' }];
  const sources = await verifySources('鸣潮', [
    { url: 'https://evil.test', quote: '维护时间：2026年9月30日04:00开始更新', claims: ['current_release_date'] },
    { url: 'https://evil.test', quote: '该游戏从来不存在的更新事实', claims: ['current_content'] },
  ], evidence);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, evidence[0].url);
  assert.equal(citedReleaseDate({ current_release_date: '2026-09-30' }, sources), '2026-09-30');
  assert.equal(citedReleaseDate({ current_release_date: '2026-10-01' }, sources), null);
});

test('month/day release uses verified publication year, not current year', () => {
  const sources = [{ quote: '《崩坏3》将在9月24日进行版本更新维护', claims: ['current_release_date'], published_at: '2026-09-22T00:00:00Z' }];
  assert.equal(citedReleaseDate({ current_release_date: '2026-09-24' }, sources), '2026-09-24');
  assert.equal(citedReleaseDate({ current_release_date: '2027-09-24' }, sources), null);
});

test('official duration overrides default 42 days; historical cycle requires three dates', () => {
  assert.equal(officialVersionEnd('4.6版本', [{ title: '4.6版本更新说明', text: '4.6版本的持续时间为 2026/09/28 4.6版本更新后 - 2026/11/11 06:00。' }]).date, '2026-11-11');
  const evidence = [['8.9', '5', '28'], ['9.0', '7', '23'], ['9.1', '9', '24']].map(([version, m, d]) => ({ title: `${version}版本维护通知`, text: `将在${m}月${d}日进行版本更新维护`, published_at: `2026-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z` }));
  assert.equal(observedCycle(evidence).days, 60);
  assert.equal(observedCycle(evidence.slice(1)), null);
});
