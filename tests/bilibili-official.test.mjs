import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BILIBILI_OFFICIAL_ACCOUNTS, summarizeDynamicBody } from '../agent/lib/browser.mjs';
import { GAME_NAMES, validateDataset } from '../agent/lib/validate.mjs';

const expectedMids = {
  原神: '401742377',
  '崩坏：星穹铁道': '1340190821',
  崩坏3: '27534330',
  绝区零: '1636034895',
  鸣潮: '1955897084',
  '明日方舟：终末地': '1265652806',
  异环: '3546636978489848',
  '星塔旅人（国服）': '3546645778139206',
};

test('fixed official Bilibili accounts exactly match tracked games', () => {
  assert.deepEqual(Object.keys(BILIBILI_OFFICIAL_ACCOUNTS), GAME_NAMES);
  assert.deepEqual(
    Object.fromEntries(Object.entries(BILIBILI_OFFICIAL_ACCOUNTS).map(([name, account]) => [name, account.mid])),
    expectedMids,
  );
});

test('dynamic body fallback produces concise source titles instead of generic official-dynamic labels', () => {
  assert.equal(
    summarizeDynamicBody(
      '#原神#\n「月之一」版本活动祈愿即将开启，旅行者可关注后续角色与武器信息。\n更多详情请见长图。',
      '原神',
    ),
    '「月之一」版本活动祈愿即将开启，旅行者可关注后续角色与武器信息。',
  );
  assert.equal(summarizeDynamicBody('原神\n09-18 12:00\n新版本现已开放！', '原神'), '新版本现已开放！');
});

test('dataset tracks exactly 8 games and contains preview image metadata', async () => {
  const dataset = JSON.parse(await readFile(new URL('../data/games.json', import.meta.url), 'utf8'));
  validateDataset(dataset);
  assert.equal(dataset.games.length, 8);
  assert.equal(dataset.games.some((game) => game.game_name === '蔚蓝档案（日服）'), false);
  for (const game of dataset.games) assert.ok(Array.isArray(game.preview_images));
});
