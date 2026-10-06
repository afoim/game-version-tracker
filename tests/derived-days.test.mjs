import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_NAMES, collectReviewIssues, collectClaimEvidenceIssues, collectVerifiedCoverageIssues, refreshDerivedDays, validateGame } from '../agent/lib/validate.mjs';

test('verified status requires evidence even for unchanged known facts', () => {
  const item = { url: 'https://www.bilibili.com/opus/1', title: '1.1版本', text: '1.1版本现已上线', http_status: 200, discovered_by: 'bilibili-official:401742377' };
  const child = { verification_status: 'verified', candidate: { game_name: '原神', current_version: '1.1', next_version: '暂未公布', current_version_days: null, sources: [{ url: item.url, claims: ['current_version'] }] }, claim_evidence: [] };
  assert.equal(collectVerifiedCoverageIssues(child, [item]).length, 1);
  child.claim_evidence.push({ field: 'current_version', url: item.url, quote: '1.1版本现已上线' });
  assert.deepEqual(collectVerifiedCoverageIssues(child, [item]), []);
});

test('version age accepts unknown but rejects negative and nonnumeric ages', () => {
  assert.equal(validateGame(makeGame('原神', { current_version_days: null })), true);
  assert.equal(validateGame(makeGame('原神', { current_version_days: 0 })), true);
  assert.throws(() => validateGame(makeGame('原神', { current_version_days: -1 })));
  assert.throws(() => validateGame(makeGame('原神', { current_version_days: '未知' })));
});

test('changed facts require exact public evidence, not a fabricated citation', () => {
  const before = { game_name: '原神', current_version: '1.0' };
  const evidence = [{ url: 'https://www.bilibili.com/opus/1', title: '更新公告', text: '1.1版本现已上线', http_status: 200, discovered_by: 'bilibili-official:401742377:dynamic' }];
  const child = { candidate: { ...before, current_version: '1.1', sources: [{ url: evidence[0].url, claims: ['current_version'] }] }, claim_evidence: [{ field: 'current_version', url: evidence[0].url, quote: '1.1版本现已上线' }] };
  assert.deepEqual(collectClaimEvidenceIssues(before, child, evidence), []);
  child.claim_evidence[0].quote = '1.2版本现已上线';
  assert.equal(collectClaimEvidenceIssues(before, child, evidence).length, 1);
  child.claim_evidence[0].quote = '1.1版本现已上线';
  child.candidate.sources[0].claims = [];
  assert.equal(collectClaimEvidenceIssues(before, child, evidence).length, 1);
});

const NOW = Date.parse('2026-09-23T12:00:00+08:00');

test('unknown banner expiry clears a leftover countdown', () => {
  const game = { current_up_end_at: null, current_up_days_remaining: 12 };
  refreshDerivedDays(game);
  assert.equal(game.current_up_days_remaining, null);
});

test('banner opening clock cannot be invented from maintenance or a release date', () => {
  const before = { game_name: '原神', current_up_start_at: null };
  const item = { url: 'https://www.bilibili.com/opus/1', title: '公告', text: '9月28日版本更新后开启\n更新开始时间：06:00\n跃迁时间：2026/09/28 12:00', http_status: 200, discovered_by: 'bilibili-official:401742377' };
  const child = { candidate: { ...before, current_up_start_at: '2026-09-28T06:00:00+08:00', sources: [{ url: item.url, claims: ['current_up_start_at'] }] }, claim_evidence: [{ field: 'current_up_start_at', url: item.url, quote: '更新开始时间：06:00' }] };
  assert.equal(collectClaimEvidenceIssues(before, child, [item]).length, 1);
  child.claim_evidence[0].quote = '9月28日版本更新后开启';
  assert.equal(collectClaimEvidenceIssues(before, child, [item]).length, 1);
  child.candidate.current_up_start_at = '2026-09-28T12:00:00+08:00';
  child.claim_evidence[0].quote = '跃迁时间：2026/09/28 12:00';
  assert.deepEqual(collectClaimEvidenceIssues(before, child, [item]), []);
});

function makeGame(gameName, overrides = {}) {
  return {
    game_name: gameName,
    current_version: '1.0',
    current_content: ['内容'],
    current_version_days: 10,
    next_version: '1.1',
    next_content: ['下一版本内容'],
    preview_status: '已发布',
    preview_title: null,
    preview_start_at: null,
    preview_live_url: null,
    preview_replay_url: null,
    preview_images: [],
    days_to_next_version: 6,
    current_up_characters: ['角色A'],
    current_up_start_at: '2026-09-01T18:00:00+08:00',
    current_up_end_at: '2026-09-22T14:59:00+08:00',
    current_up_days_remaining: 5,
    sources: [
      {
        title: '官方动态',
        url: 'https://www.bilibili.com/opus/1',
        type: 'official_community',
        claims: ['current_version'],
        checked_at: '2026-09-17T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function makeDataset(staleGameName = null) {
  return {
    games: GAME_NAMES.map((name) =>
      makeGame(name, name === staleGameName ? { current_up_characters: ['旧角色'] } : {}),
    ),
  };
}

test('refreshDerivedDays recomputes remaining days from the absolute UP end time', () => {
  const game = refreshDerivedDays(
    { current_up_end_at: '2026-09-30T11:59:00+08:00', current_up_days_remaining: 999 },
    NOW,
  );
  assert.equal(game.current_up_days_remaining, 7);

  const expired = refreshDerivedDays(
    { current_up_end_at: '2026-09-22T14:59:00+08:00', current_up_days_remaining: 5 },
    NOW,
  );
  assert.equal(expired.current_up_days_remaining, 0);

  const unknown = refreshDerivedDays({ current_up_end_at: null, current_up_days_remaining: 3 }, NOW);
  assert.equal(unknown.current_up_days_remaining, null);
});

test('insufficient games keep stale data without blocking the batch', () => {
  const currentDataset = makeDataset('原神');
  const childResults = GAME_NAMES.map((name) => ({
    game_name: name,
    verification_status: 'insufficient',
    changed: false,
    candidate: currentDataset.games.find((game) => game.game_name === name),
    notes: [],
  }));

  const issues = collectReviewIssues({
    currentDataset,
    proposedDataset: structuredClone(currentDataset),
    childResults,
    evidenceByGame: Object.fromEntries(GAME_NAMES.map((name) => [name, []])),
    now: NOW,
  });

  assert.deepEqual(issues, []);
});

test('verified games still reject an expired UP that keeps characters', () => {
  const currentDataset = makeDataset();
  const proposedDataset = structuredClone(currentDataset);
  const evidenceByGame = Object.fromEntries(
    GAME_NAMES.map((name) => [
      name,
      [
        {
          title: '官方动态',
          url: 'https://www.bilibili.com/opus/1',
          discovered_by: 'bilibili-official:1:',
          checked_at: '2026-09-23T00:00:00.000Z',
          text: '当前 UP',
        },
      ],
    ]),
  );
  const childResults = GAME_NAMES.map((name) => ({
    game_name: name,
    verification_status: 'verified',
    changed: false,
    candidate: proposedDataset.games.find((game) => game.game_name === name),
    notes: [],
  }));

  const issues = collectReviewIssues({
    currentDataset,
    proposedDataset,
    childResults,
    evidenceByGame,
    now: NOW,
  });

  assert.ok(issues.some((issue) => issue.includes('原神: 当前 UP 已明显结束但仍保留角色')));
});


test('verified candidates reject a next version that has already become current', () => {
  const currentDataset = makeDataset();
  const proposedDataset = structuredClone(currentDataset);
  proposedDataset.games[0].next_version = proposedDataset.games[0].current_version;
  const childResults = GAME_NAMES.map((name, index) => ({
    game_name: name, verification_status: index === 0 ? 'verified' : 'insufficient',
    changed: index === 0, candidate: proposedDataset.games[index], notes: [],
  }));
  const issues = collectReviewIssues({ currentDataset, proposedDataset, childResults,
    evidenceByGame: {}, now: NOW });
  assert.ok(issues.some((issue) => issue.includes('next_version') && issue.includes('current_version')));
});
