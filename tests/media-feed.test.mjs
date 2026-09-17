import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMediaFeed,
  classifyOfficialMedia,
  validateMediaFeed,
} from '../agent/lib/media-feed.mjs';

const baseCandidate = {
  game_name: '异环',
  official_mid: '3546636978489848',
  official_slug: 'yh',
  dynamic_id: '123',
  dynamic_url: 'https://www.bilibili.com/opus/123',
  bvid: 'BV1TEST12345',
  description: '',
  url: 'https://www.bilibili.com/video/BV1TEST12345/',
  player_url: 'https://player.bilibili.com/player.html?bvid=BV1TEST12345',
  published_at: '2026-09-17T10:00:00.000Z',
  duration: '02:30',
  remote_cover: 'https://i0.hdslb.com/bfs/archive/test.jpg',
  text: '',
};

test('classifies official PV titles deterministically', () => {
  assert.equal(
    classifyOfficialMedia({ ...baseCandidate, title: '《异环》1.4版本PV「祷歌为谁而诵」' }),
    'version_pv',
  );
  assert.equal(
    classifyOfficialMedia({ ...baseCandidate, title: '《异环》角色PV丨灵可' }),
    'character_pv',
  );
  assert.equal(
    classifyOfficialMedia({ ...baseCandidate, title: '《绝区零》先导演示丨蕾米埃尔' }),
    'character_pv',
  );
  assert.equal(
    classifyOfficialMedia({ ...baseCandidate, title: '《明日方舟：终末地》干员战斗演示 - 诀' }),
    'character_pv',
  );
  assert.equal(
    classifyOfficialMedia({ ...baseCandidate, title: '《异环》1.4版本前瞻特别节目回顾' }),
    'preview_program',
  );
  assert.equal(
    classifyOfficialMedia({ ...baseCandidate, title: '《异环》动画短片丨城市夜话' }),
    'short_film',
  );
  assert.equal(classifyOfficialMedia({ ...baseCandidate, title: '普通活动公告' }), null);
});

test('builds server-driven feed with ui, real data and media resources', () => {
  const dataset = {
    games: [
      {
        game_name: '异环',
        current_version: '1.3',
        next_version: '1.4',
        preview_status: '已发布',
        preview_title: '《异环》1.4版本前瞻特别节目',
        preview_start_at: '2026-09-16T19:30:00+08:00',
        preview_live_url: null,
        preview_replay_url: 'https://www.bilibili.com/video/BV1TEST12345/',
        preview_images: [],
        sources: [
          {
            checked_at: '2026-09-17T10:00:00.000Z',
          },
        ],
      },
    ],
  };
  const mediaByGame = {
    异环: [
      { ...baseCandidate, title: '《异环》1.4版本PV「祷歌为谁而诵」' },
      {
        ...baseCandidate,
        bvid: 'BV1ROLE12345',
        url: 'https://www.bilibili.com/video/BV1ROLE12345/',
        player_url: 'https://player.bilibili.com/player.html?bvid=BV1ROLE12345',
        title: '《异环》角色PV丨灵可',
      },
    ],
  };

  const { feed, coverPlan } = buildMediaFeed({
    dataset,
    mediaByGame,
    baseUrl: 'https://game-version-tracker.pages.dev',
  });

  validateMediaFeed(feed);
  assert.equal(feed.schema_version, 2);
  assert.equal(feed.ui.sections.length, 1);
  assert.equal(feed.ui.sections[0].component, 'game_status_grid');
  assert.equal(feed.ui.sections[0].props.columns.xl, 4);
  assert.equal(feed.ui.sections[0].props.embedded_media.source, 'media.items');
  assert.equal(feed.ui.sections[0].props.embedded_media.limit_per_game, 4);
  assert.deepEqual(feed.ui.sections[0].props.embedded_media.categories, [
    'version_pv',
    'character_pv',
    'preview_program',
    'short_film',
    'promotional_pv',
  ]);
  assert.equal(feed.data.games[0].current_version, '1.3');
  assert.equal(
    feed.data.games[0].icon_url,
    'https://game-version-tracker.pages.dev/media/game-icons/yh.ico',
  );
  assert.equal(feed.media.items.length, 2);
  assert.deepEqual(
    feed.media.items.map((item) => item.category),
    ['version_pv', 'character_pv'],
  );
  assert.equal(coverPlan.length, 2);
  assert.match(feed.media.items[0].poster_url, /\/media\/catalog\/yh\//);
});
