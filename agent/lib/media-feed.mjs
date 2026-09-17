const CATEGORY_LABELS = {
  version_pv: '版本 PV',
  character_pv: '角色 PV',
  preview_program: '版本前瞻',
  short_film: '动画短片',
  promotional_pv: '宣传影像',
};

const GAME_ICON_FILES = {
  原神: 'genshin.ico',
  '崩坏：星穹铁道': 'starrail.ico',
  崩坏3: 'honkai3.ico',
  绝区零: 'zzz.ico',
  鸣潮: 'wuwa.ico',
  '明日方舟：终末地': 'endfield.png',
  异环: 'yh.ico',
  '星塔旅人（国服）': 'stellasora.webp',
};

export const MEDIA_CATEGORIES = Object.freeze(Object.keys(CATEGORY_LABELS));

export function buildFeedGames(games, baseUrl) {
  const normalizedBaseUrl = String(baseUrl).replace(/\/$/, '');
  return structuredClone(games).map((game) => ({
    ...game,
    icon_url: GAME_ICON_FILES[game.game_name]
      ? `${normalizedBaseUrl}/media/game-icons/${GAME_ICON_FILES[game.game_name]}`
      : null,
  }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function imageExtension(rawUrl) {
  try {
    const match = new URL(rawUrl).pathname.match(/\.(jpg|jpeg|png|webp|avif)$/i);
    if (match) return `.${match[1].toLowerCase()}`;
  } catch {
    // Fall through to jpg.
  }
  return '.jpg';
}

export function classifyOfficialMedia(item) {
  const title = normalizeText(item?.title);

  if (/前瞻|特别节目|特別番組|通讯|生放送|予告番組/i.test(title)) {
    return 'preview_program';
  }
  if (
    /(?:\d+(?:\.\d+)+\s*版本[^\n]{0,24}PV)|版本\s*PV|版本宣传(?:片|PV)|版本预告(?:片|PV)|Version\s*\d+(?:\.\d+)+[^\n]{0,24}(?:Trailer|PV)/i.test(
      title,
    )
  ) {
    return 'version_pv';
  }
  if (
    /角色\s*PV|角色演示|角色展示|角色预告|角色介绍[^\n]{0,12}PV|角色动画短片|先导演示|干员(?:战斗)?演示/i.test(
      title,
    )
  ) {
    return 'character_pv';
  }
  if (/动画短片|动画\s*CM|剧情短片|角色短片|特别动画/i.test(title)) {
    return 'short_film';
  }
  if (/\bPV\b|宣传\s*PV|概念\s*PV|预告片|Trailer|特别映像|概念CG/i.test(title)) {
    return 'promotional_pv';
  }
  return null;
}

function mediaItem(candidate, game, baseUrl) {
  const category = classifyOfficialMedia(candidate);
  if (!category) return null;
  const slug = candidate.official_slug;
  const coverRelativePath = candidate.remote_cover
    ? `media/catalog/${slug}/${candidate.bvid}${imageExtension(candidate.remote_cover)}`
    : null;
  const version = normalizeText(candidate.title).match(/(\d+(?:\.\d+)+)\s*版本/)?.[1] || null;

  return {
    id: `${slug}:${candidate.bvid}`,
    game_name: game.game_name,
    category,
    category_label: CATEGORY_LABELS[category],
    title: candidate.title,
    description: candidate.description || null,
    version,
    bvid: candidate.bvid,
    published_at: candidate.published_at,
    duration: candidate.duration || null,
    url: candidate.url,
    player_url: candidate.player_url,
    poster_url: coverRelativePath ? `${baseUrl}/${coverRelativePath}` : null,
    source: {
      platform: 'bilibili',
      official_mid: candidate.official_mid,
      dynamic_url: candidate.dynamic_url,
    },
    _remote_cover: candidate.remote_cover || null,
    _cover_relative_path: coverRelativePath,
  };
}

function publicMediaItem(item) {
  const clone = { ...item };
  delete clone._remote_cover;
  delete clone._cover_relative_path;
  return clone;
}

export function buildMediaFeed({ dataset, mediaByGame, baseUrl, generatedAt = null }) {
  const normalizedBaseUrl = String(baseUrl).replace(/\/$/, '');
  const allItems = [];
  const coverPlan = [];

  for (const game of dataset.games) {
    const candidates = mediaByGame[game.game_name] || [];
    const seen = new Set();
    let accepted = 0;
    for (const candidate of candidates) {
      if (!candidate?.bvid || seen.has(candidate.bvid)) continue;
      seen.add(candidate.bvid);
      const item = mediaItem(candidate, game, normalizedBaseUrl);
      if (!item) continue;
      allItems.push(item);
      if (item._remote_cover && item._cover_relative_path) {
        coverPlan.push({
          id: item.id,
          remote_url: item._remote_cover,
          relative_path: item._cover_relative_path,
          public_url: item.poster_url,
        });
      }
      accepted += 1;
      if (accepted >= 4) break;
    }
  }

  allItems.sort((a, b) => Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0));
  const items = allItems.map(publicMediaItem);
  const allowedIds = new Set(items.map((item) => item.id));
  const filteredPlan = coverPlan.filter((item) => allowedIds.has(item.id));
  const timestamps = [
    ...items.map((item) => Date.parse(item.published_at || 0)),
    ...dataset.games.flatMap((game) =>
      (game.sources || []).map((source) => Date.parse(source.checked_at || 0)),
    ),
  ].filter(Number.isFinite);
  const resolvedGeneratedAt = generatedAt ||
    (timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : new Date(0).toISOString());

  const feed = {
    schema_version: 2,
    generated_at: resolvedGeneratedAt,
    ui: {
      page: {
        title: '游戏资讯',
        subtitle: '官方版本动态、角色 PV、版本 PV 与前瞻节目',
        max_width: '7xl',
        density: 'compact',
      },
      sections: [
        {
          id: 'game-status',
          component: 'game_status_grid',
          source: 'data.games',
          title: '版本状态',
          description: '当前版本、下版本、前瞻、官方影像与当期 UP',
          props: {
            columns: { base: 1, md: 2, xl: 4 },
            show_preview: true,
            show_up: true,
            show_sources: true,
            embedded_media: {
              source: 'media.items',
              position: 'after_preview',
              categories: ['version_pv', 'character_pv', 'preview_program', 'short_film', 'promotional_pv'],
              limit_per_game: 4,
              layout: 'featured_compact',
              show_category: true,
              show_duration: true,
              show_player: true,
              empty_behavior: 'hide',
            },
          },
        },
      ],
      components: {
        media_card: {
          image_field: 'poster_url',
          title_field: 'title',
          eyebrow_field: 'category_label',
          meta_fields: ['game_name', 'published_at', 'duration'],
          primary_action: { label: '在 Bilibili 观看', field: 'url' },
          player_field: 'player_url',
        },
        game_status_card: {
          title_field: 'game_name',
          current_version_field: 'current_version',
          next_version_field: 'next_version',
          preview_fields: ['preview_status', 'preview_title', 'preview_start_at', 'preview_live_url', 'preview_replay_url'],
          up_fields: ['current_up_characters', 'current_up_start_at', 'current_up_end_at'],
        },
      },
    },
    data: {
      games: buildFeedGames(dataset.games, normalizedBaseUrl),
    },
    media: {
      categories: MEDIA_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
      items,
    },
  };

  validateMediaFeed(feed);
  return { feed, coverPlan: filteredPlan };
}

export function validateMediaFeed(feed) {
  assert(feed && typeof feed === 'object', 'media-feed 必须是对象');
  assert(feed.schema_version === 2, 'media-feed.schema_version 必须为 2');
  assert(typeof feed.generated_at === 'string' && Number.isFinite(Date.parse(feed.generated_at)), 'media-feed.generated_at 非法');
  assert(feed.ui && typeof feed.ui === 'object', 'media-feed.ui 缺失');
  assert(Array.isArray(feed.ui.sections) && feed.ui.sections.length > 0, 'media-feed.ui.sections 缺失');
  const components = new Set(['media_grid', 'game_status_grid']);
  for (const section of feed.ui.sections) {
    assert(typeof section.id === 'string' && section.id, 'media-feed section.id 非法');
    assert(components.has(section.component), `未知 UI component: ${section.component}`);
    assert(typeof section.source === 'string' && section.source, `section ${section.id} source 非法`);
    if (section.component === 'game_status_grid' && section.props?.embedded_media) {
      const embedded = section.props.embedded_media;
      assert(embedded.source === 'media.items', `${section.id}.embedded_media.source 非法`);
      assert(
        Number.isInteger(embedded.limit_per_game) && embedded.limit_per_game > 0 && embedded.limit_per_game <= 8,
        `${section.id}.embedded_media.limit_per_game 非法`,
      );
      assert(
        Array.isArray(embedded.categories) && embedded.categories.every((id) => MEDIA_CATEGORIES.includes(id)),
        `${section.id}.embedded_media.categories 非法`,
      );
    }
  }
  assert(Array.isArray(feed.data?.games), 'media-feed.data.games 必须是数组');
  for (const game of feed.data.games) {
    assert(typeof game.game_name === 'string' && game.game_name, 'media-feed game_name 非法');
    assert(typeof game.icon_url === 'string' && /^https?:\/\//.test(game.icon_url), `${game.game_name} icon_url 非法`);
  }
  assert(Array.isArray(feed.media?.items), 'media-feed.media.items 必须是数组');
  const ids = new Set();
  for (const item of feed.media.items) {
    assert(typeof item.id === 'string' && item.id, 'media item.id 非法');
    assert(!ids.has(item.id), `media item.id 重复: ${item.id}`);
    ids.add(item.id);
    assert(MEDIA_CATEGORIES.includes(item.category), `media category 非法: ${item.category}`);
    assert(typeof item.title === 'string' && item.title, `${item.id} title 非法`);
    assert(/^https:\/\/www\.bilibili\.com\/video\/BV/.test(item.url), `${item.id} 视频 URL 非官方 Bilibili video`);
    assert(/^https:\/\/player\.bilibili\.com\//.test(item.player_url), `${item.id} player_url 非法`);
    if (item.poster_url !== null) assert(/^https?:\/\//.test(item.poster_url), `${item.id} poster_url 非法`);
    assert(item.source?.platform === 'bilibili', `${item.id} source.platform 非法`);
    assert(typeof item.source?.official_mid === 'string' && item.source.official_mid, `${item.id} official_mid 缺失`);
  }
  return true;
}
