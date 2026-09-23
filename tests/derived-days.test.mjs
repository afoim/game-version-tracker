import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_NAMES, collectReviewIssues, refreshDerivedDays } from '../agent/lib/validate.mjs';

const NOW = Date.parse('2026-09-23T12:00:00+08:00');

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
  assert.equal(unknown.current_up_days_remaining, 3);
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
