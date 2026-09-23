export const GAME_NAMES = [
  '原神',
  '崩坏：星穹铁道',
  '崩坏3',
  '绝区零',
  '鸣潮',
  '明日方舟：终末地',
  '异环',
  '星塔旅人（国服）',
];

const SOURCE_TYPES = new Set(['official_api', 'official', 'official_community', 'secondary']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateGame(game, { evidenceUrls = null, requireEvidenceSources = false } = {}) {
  assert(game && typeof game === 'object', 'game 必须是对象');
  assert(GAME_NAMES.includes(game.game_name), `未知游戏: ${game.game_name}`);
  for (const key of ['current_version', 'next_version', 'preview_status']) {
    assert(typeof game[key] === 'string', `${game.game_name}.${key} 必须是字符串`);
  }
  for (const key of ['preview_title', 'preview_start_at', 'preview_live_url', 'preview_replay_url']) {
    assert(game[key] === null || typeof game[key] === 'string', `${game.game_name}.${key} 必须是字符串或 null`);
  }
  assert(Array.isArray(game.preview_images), `${game.game_name}.preview_images 必须是数组`);
  assert(
    game.preview_images.every((value) => typeof value === 'string' && /^https?:\/\//.test(value)),
    `${game.game_name}.preview_images 只能包含 HTTP(S) URL`,
  );
  if (game.preview_start_at !== null) {
    assert(Number.isFinite(Date.parse(game.preview_start_at)), `${game.game_name}.preview_start_at 必须是有效日期或 null`);
  }
  for (const key of ['preview_live_url', 'preview_replay_url']) {
    if (game[key] !== null) {
      assert(/^https?:\/\//.test(game[key]), `${game.game_name}.${key} 必须是 HTTP(S) URL 或 null`);
    }
  }
  for (const key of ['current_content', 'next_content', 'current_up_characters']) {
    assert(Array.isArray(game[key]), `${game.game_name}.${key} 必须是数组`);
    assert(game[key].every((value) => typeof value === 'string'), `${game.game_name}.${key} 只能包含字符串`);
  }
  for (const key of ['current_version_days', 'days_to_next_version']) {
    assert(Number.isInteger(game[key]) && game[key] >= 0, `${game.game_name}.${key} 必须是非负整数`);
  }
  for (const key of ['current_up_start_at', 'current_up_end_at']) {
    assert(game[key] === null || typeof game[key] === 'string', `${game.game_name}.${key} 必须是字符串或 null`);
  }
  assert(
    game.current_up_days_remaining === null ||
      (Number.isInteger(game.current_up_days_remaining) && game.current_up_days_remaining >= 0),
    `${game.game_name}.current_up_days_remaining 必须是非负整数或 null`,
  );

  assert(Array.isArray(game.sources), `${game.game_name}.sources 必须是数组`);
  if (requireEvidenceSources) assert(game.sources.length > 0, `${game.game_name} 的候选数据必须保留本轮实际读取来源`);
  for (const source of game.sources) {
    assert(source && typeof source === 'object', `${game.game_name}.sources 项必须是对象`);
    assert(typeof source.title === 'string' && source.title.length > 0, `${game.game_name} 来源缺少 title`);
    assert(typeof source.url === 'string' && /^https?:\/\//.test(source.url), `${game.game_name} 来源 URL 非法`);
    assert(SOURCE_TYPES.has(source.type), `${game.game_name} 来源 type 非法: ${source.type}`);
    assert(Array.isArray(source.claims) && source.claims.every((value) => typeof value === 'string'), `${game.game_name} 来源 claims 非法`);
    assert(typeof source.checked_at === 'string' && source.checked_at.length > 0, `${game.game_name} 来源缺少 checked_at`);
    if (evidenceUrls) {
      assert(evidenceUrls.has(source.url), `${game.game_name} 来源未由本轮 Playwright 实际读取: ${source.url}`);
    }
  }
  return true;
}

export function validateDataset(dataset) {
  assert(dataset && typeof dataset === 'object' && Array.isArray(dataset.games), '根对象必须包含 games 数组');
  assert(dataset.games.length === GAME_NAMES.length, `必须恰好包含 ${GAME_NAMES.length} 个游戏`);
  const names = dataset.games.map((game) => game.game_name);
  assert(new Set(names).size === names.length, 'game_name 不能重复');
  for (const name of GAME_NAMES) assert(names.includes(name), `缺少游戏: ${name}`);
  for (const game of dataset.games) validateGame(game);
  return true;
}

function factView(game) {
  const clone = structuredClone(game);
  delete clone.sources;
  delete clone.preview_images;
  return clone;
}

export function hasMeaningfulChange(before, after) {
  return JSON.stringify(factView(before)) !== JSON.stringify(factView(after));
}

export function validateAssignments(assignments) {
  assert(Array.isArray(assignments), 'main-agent assignments 必须是数组');
  assert(assignments.length === GAME_NAMES.length, `main-agent 必须分配全部 ${GAME_NAMES.length} 个游戏`);
  const names = assignments.map((item) => item?.game_name);
  assert(new Set(names).size === GAME_NAMES.length, 'main-agent 分配存在重复或缺失');
  for (const name of GAME_NAMES) assert(names.includes(name), `main-agent 未分配: ${name}`);
  for (const item of assignments) {
    assert(typeof item.objective === 'string' && item.objective.length > 0, `${item.game_name} 缺少 objective`);
  }
  return true;
}

// current_up_days_remaining is a pure function of the stored absolute
// current_up_end_at, so refresh it deterministically instead of trusting the
// model to recount it. This keeps the countdown from going stale whenever a
// child-agent verifies a game without otherwise changing its facts.
export function refreshDerivedDays(game, now = Date.now()) {
  if (game.current_up_end_at) {
    const end = Date.parse(game.current_up_end_at);
    if (Number.isFinite(end)) {
      game.current_up_days_remaining = Math.max(0, Math.ceil((end - now) / 86400000));
    }
  }
  return game;
}

function parseDate(value) {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NaN;
}

export function collectReviewIssues({ currentDataset, proposedDataset, childResults, evidenceByGame, now = Date.now() }) {
  const issues = [];

  try {
    validateDataset(currentDataset);
  } catch (error) {
    issues.push(`原始数据结构异常: ${error.message}`);
  }
  try {
    validateDataset(proposedDataset);
  } catch (error) {
    issues.push(`候选数据结构异常: ${error.message}`);
  }

  for (const gameName of GAME_NAMES) {
    const child = childResults.find((item) => item?.game_name === gameName);
    const evidence = evidenceByGame[gameName] || [];
    const proposedGame = proposedDataset.games.find((game) => game.game_name === gameName);
    const currentGame = currentDataset.games.find((game) => game.game_name === gameName);

    if (!child) {
      issues.push(`${gameName}: 缺少 child-agent 结果`);
      continue;
    }
    if (!proposedGame || !currentGame) {
      issues.push(`${gameName}: 候选数据缺失`);
      continue;
    }

    const verified = child.verification_status === 'verified';
    const reviewCandidate = verified ? child.candidate : currentGame;

    if (verified) {
      if (evidence.length === 0) {
        issues.push(`${gameName}: child-agent 标记 verified，但没有本轮 Playwright 成功读取的外部来源`);
      }
      const evidenceUrls = new Set(evidence.map((item) => item.url));
      const evidenceByUrl = new Map(evidence.map((item) => [item.url, item]));
      try {
        validateGame(reviewCandidate, { evidenceUrls, requireEvidenceSources: true });
      } catch (error) {
        issues.push(`${gameName}: ${error.message}`);
      }
      for (const source of reviewCandidate.sources || []) {
        const item = evidenceByUrl.get(source.url);
        if (!String(item?.discovered_by || '').startsWith('bilibili-official:')) {
          issues.push(`${gameName}: 来源不是固定 Bilibili 官方账号 evidence: ${source.url}`);
        }
      }
    } else if (child.verification_status === 'insufficient') {
      // Evidence can legitimately be unavailable or too weak for a single game.
      // Safe degradation means that game must remain byte-for-byte factual old
      // data; it must not block reliable updates for other games.
      if (hasMeaningfulChange(currentGame, proposedGame)) {
        issues.push(`${gameName}: 证据不足时 proposedDataset 不得修改旧事实`);
      }
      if (child.changed) {
        issues.push(`${gameName}: 证据不足时 child-agent 不得声明 changed=true`);
      }
      try {
        validateGame(proposedGame);
      } catch (error) {
        issues.push(`${gameName}: ${error.message}`);
      }
    } else {
      issues.push(`${gameName}: 非法 verification_status=${child.verification_status || 'unknown'}`);
    }

    // Date/UP checks only apply to this round's verified candidates. An
    // insufficient game intentionally keeps byte-for-byte old data; its
    // pre-existing staleness must not block reliable updates for other games.
    if (verified) {
      const start = parseDate(reviewCandidate.current_up_start_at);
      const end = parseDate(reviewCandidate.current_up_end_at);
      if (Number.isNaN(start)) issues.push(`${gameName}: current_up_start_at 不是有效日期`);
      if (Number.isNaN(end)) issues.push(`${gameName}: current_up_end_at 不是有效日期`);
      if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
        issues.push(`${gameName}: 当前 UP 结束时间不晚于开始时间`);
      }
      if (reviewCandidate.current_up_characters.length > 0 && Number.isFinite(end) && end < now - 60 * 60 * 1000) {
        issues.push(`${gameName}: 当前 UP 已明显结束但仍保留角色`);
      }
      if (Number.isFinite(end) && reviewCandidate.current_up_days_remaining !== null) {
        const expected = Math.max(0, Math.ceil((end - now) / 86400000));
        if (Math.abs(reviewCandidate.current_up_days_remaining - expected) > 1) {
          issues.push(`${gameName}: current_up_days_remaining=${reviewCandidate.current_up_days_remaining} 与结束时间推算值 ${expected} 明显不一致`);
        }
      }
    }

    const factChanged = hasMeaningfulChange(currentGame, reviewCandidate);
    if (Boolean(child.changed) !== factChanged) {
      issues.push(`${gameName}: child-agent changed 标记与实际事实差异不一致`);
    }

    if (verified && factChanged && hasMeaningfulChange(proposedGame, reviewCandidate)) {
      issues.push(`${gameName}: 已核验的事实变化没有正确合并到 proposedDataset`);
    }
    if ((!verified || !factChanged) && hasMeaningfulChange(currentGame, proposedGame)) {
      issues.push(`${gameName}: 没有已核验事实变化时 proposedDataset 不得修改旧事实`);
    }
  }

  return issues;
}
