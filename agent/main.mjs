import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BILIBILI_OFFICIAL_ACCOUNTS, createEvidenceCollector } from './lib/browser.mjs';
import { extractJson } from './lib/json.mjs';
import { createLlmRunner } from './lib/opencode.mjs';
import {
  GAME_NAMES,
  collectReviewIssues,
  hasMeaningfulChange,
  validateAssignments,
  validateDataset,
  validateGame,
} from './lib/validate.mjs';
import { childPrompt, mainPlanPrompt, reviewPrompt } from './prompts.mjs';

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, 'data', 'games.json');
const MEDIA_ROOT = path.join(ROOT, 'data', 'media');
const OUTPUT_DIR = path.join(ROOT, 'agent-output');
const REPORT_PATH = path.join(OUTPUT_DIR, 'report.json');
const PUBLIC_DATA_BASE_URL = String(
  process.env.GAME_DATA_BASE_URL || 'https://game-version-tracker.pages.dev',
).replace(/\/$/, '');
const dryRun = process.argv.includes('--dry-run') || process.env.AGENT_DRY_RUN === 'true';
const PREVIEW_FIELDS = ['preview_status', 'preview_title', 'preview_start_at', 'preview_live_url', 'preview_replay_url'];

function log(message) {
  console.log(`[agent] ${message}`);
}

async function callJson(runner, role, prompt) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const suffix = attempt === 1 ? '' : '\n\n上一次输出无法被程序解析。现在只输出严格 JSON，不要任何额外文字。';
      const response = await runner.run(`${prompt}${suffix}`);
      return {
        value: extractJson(response.text),
        cliSessionId: response.cliSessionId,
        raw: response.text,
      };
    } catch (error) {
      lastError = error;
      log(`${role} 第 ${attempt} 次调用失败: ${error.message}`);
    }
  }
  throw lastError;
}

function evidenceSummary(evidenceByGame) {
  return Object.fromEntries(
    Object.entries(evidenceByGame).map(([game, items]) => [
      game,
      items.map((item) => ({
        title: item.title,
        url: item.url,
        http_status: item.http_status,
        checked_at: item.checked_at,
        discovered_by: item.discovered_by,
        preview_related: Boolean(item.preview_related),
        image_count: Array.isArray(item.images) ? item.images.length : 0,
        excerpt: item.text.slice(0, 2200),
      })),
    ]),
  );
}

function sourceIdentity(sources) {
  return (sources || [])
    .map((source) => ({
      title: source.title,
      url: source.url,
      type: source.type,
      claims: [...(source.claims || [])].sort(),
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

function hasMeaningfulSourceChange(before, after) {
  return JSON.stringify(sourceIdentity(before.sources)) !== JSON.stringify(sourceIdentity(after.sources));
}

function normalizedEvidenceText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function previewValueSupported(field, value, item) {
  if (field === 'preview_status') return true;
  if (value === null) return true;
  const evidenceText = `${item?.title || ''}\n${item?.url || ''}\n${item?.text || ''}`;
  if (field === 'preview_title') {
    const target = normalizedEvidenceText(value);
    return Boolean(target) && normalizedEvidenceText(evidenceText).includes(target);
  }
  if (field === 'preview_live_url' || field === 'preview_replay_url') {
    try {
      const url = new URL(value);
      const bvid = `${url.pathname}${url.search}`.match(/\b(BV[0-9A-Za-z]+)\b/i)?.[1];
      if (bvid) return evidenceText.toUpperCase().includes(bvid.toUpperCase());
      const liveId = url.hostname === 'live.bilibili.com' ? url.pathname.split('/').filter(Boolean)[0] : null;
      if (liveId) return evidenceText.includes(`live.bilibili.com/${liveId}`);
      return evidenceText.includes(value);
    } catch {
      return false;
    }
  }
  if (field === 'preview_start_at') {
    const instant = Date.parse(value);
    if (!Number.isFinite(instant)) return false;
    const offset = String(value).match(/([+-])(\d{2}):(\d{2})$/);
    const offsetMinutes = offset
      ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]))
      : 0;
    const local = new Date(instant + offsetMinutes * 60000);
    const year = local.getUTCFullYear();
    const month = local.getUTCMonth() + 1;
    const day = local.getUTCDate();
    const hour = local.getUTCHours();
    const minute = String(local.getUTCMinutes()).padStart(2, '0');
    const dateSupported = [
      `${year}年${month}月${day}日`,
      `${month}月${day}日`,
      `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    ].some((token) => evidenceText.includes(token));
    const timeSupported = [`${hour}:${minute}`, `${String(hour).padStart(2, '0')}:${minute}`]
      .some((token) => evidenceText.includes(token));
    return dateSupported && timeSupported;
  }
  return false;
}

function enforceBilibiliEvidence(currentGame, candidate, evidence) {
  const officialEvidence = evidence.filter((item) => String(item.discovered_by || '').startsWith('bilibili-official:'));
  const officialUrls = new Set(officialEvidence.map((item) => item.url));
  const previewUrls = new Set(officialEvidence.filter((item) => item.preview_related === true).map((item) => item.url));
  const evidenceByUrl = new Map(officialEvidence.map((item) => [item.url, item]));
  const next = structuredClone(candidate);
  const reverted = [];

  next.preview_images = Array.isArray(currentGame.preview_images) ? currentGame.preview_images : [];
  next.sources = (next.sources || [])
    .filter((source) => officialUrls.has(source?.url))
    .map((source) => ({ ...source, type: 'official_community' }));

  for (const field of PREVIEW_FIELDS) {
    if (JSON.stringify(next[field]) === JSON.stringify(currentGame[field])) continue;
    const supported = next.sources.some(
      (source) =>
        previewUrls.has(source.url) &&
        Array.isArray(source.claims) &&
        source.claims.includes(field) &&
        previewValueSupported(field, next[field], evidenceByUrl.get(source.url)),
    );
    if (supported) continue;
    next[field] = currentGame[field];
    reverted.push(field);
  }

  if (reverted.length) {
    next.sources = next.sources.map((source) => ({
      ...source,
      claims: source.claims.filter((claim) => !reverted.includes(claim)),
    }));
  }
  return { candidate: next, reverted };
}

function mediaExtension(rawUrl) {
  try {
    const ext = path.extname(new URL(rawUrl).pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext)) return ext;
  } catch {
    // Fall back below.
  }
  return '.jpg';
}

function buildPreviewMediaPlan(dataset, evidenceByGame, verifiedGames) {
  const plan = [];
  for (const game of dataset.games) {
    if (!verifiedGames.has(game.game_name)) continue;
    if (
      !game.preview_title &&
      !game.preview_start_at &&
      !game.preview_live_url &&
      !game.preview_replay_url
    ) {
      game.preview_images = [];
      continue;
    }
    const account = BILIBILI_OFFICIAL_ACCOUNTS[game.game_name];
    if (!account) continue;
    const previewEvidence = (evidenceByGame[game.game_name] || []).filter(
      (item) =>
        item.preview_related === true &&
        String(item.discovered_by || '').startsWith(`bilibili-official:${account.mid}:`),
    );
    if (!previewEvidence.length) continue;

    const imageUrls = [];
    const seen = new Set();
    for (const item of previewEvidence) {
      for (const imageUrl of item.images || []) {
        if (seen.has(imageUrl)) continue;
        seen.add(imageUrl);
        imageUrls.push(imageUrl);
        if (imageUrls.length >= 4) break;
      }
      if (imageUrls.length >= 4) break;
    }

    const dynamicId =
      previewEvidence.find((item) => item.bilibili_dynamic_id)?.bilibili_dynamic_id || 'preview';
    const items = imageUrls.map((remoteUrl, index) => {
      const fileName = `${String(index + 1).padStart(2, '0')}${mediaExtension(remoteUrl)}`;
      const relativePath = `media/${account.slug}/${dynamicId}/${fileName}`;
      return {
        remote_url: remoteUrl,
        relative_path: relativePath,
        public_url: `${PUBLIC_DATA_BASE_URL}/${relativePath}`,
      };
    });
    game.preview_images = items.map((item) => item.public_url);
    plan.push({ game_name: game.game_name, slug: account.slug, dynamic_id: dynamicId, items });
  }
  return plan;
}

async function materializePreviewMedia(dataset, plan) {
  const results = [];
  for (const entry of plan) {
    const game = dataset.games.find((item) => item.game_name === entry.game_name);
    if (!game) continue;
    const gameDir = path.join(MEDIA_ROOT, entry.slug);
    await rm(gameDir, { recursive: true, force: true });
    const published = [];
    const failures = [];

    for (const item of entry.items) {
      try {
        const url = new URL(item.remote_url);
        if (!url.hostname.endsWith('hdslb.com')) throw new Error('非 Bilibili CDN 图片');
        const response = await fetch(item.remote_url, {
          headers: {
            Referer: 'https://www.bilibili.com/',
            'User-Agent':
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36',
          },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
          throw new Error(`图片大小异常: ${bytes.length}`);
        }
        const target = path.join(ROOT, 'data', ...item.relative_path.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
        published.push(item.public_url);
      } catch (error) {
        failures.push(`${item.remote_url}: ${error.message}`);
      }
    }

    game.preview_images = published;
    results.push({
      game_name: entry.game_name,
      requested: entry.items.length,
      published: published.length,
      failures,
    });
  }
  return results;
}

function normalizeChildResult(result, gameName, currentGame, evidence) {
  if (!result || typeof result !== 'object') throw new Error(`${gameName} child-agent 返回不是对象`);
  if (result.game_name !== gameName) throw new Error(`${gameName} child-agent game_name 不匹配`);
  if (!['verified', 'insufficient'].includes(result.verification_status)) {
    throw new Error(`${gameName} verification_status 非法`);
  }
  if (!Array.isArray(result.notes)) result.notes = [];
  if (!result.candidate || typeof result.candidate !== 'object') throw new Error(`${gameName} 缺少 candidate`);

  if (result.verification_status === 'insufficient' || evidence.length === 0) {
    return {
      game_name: gameName,
      verification_status: 'insufficient',
      changed: false,
      candidate: currentGame,
      notes: result.notes,
    };
  }

  const evidenceByUrl = new Map(evidence.map((item) => [item.url, item]));
  result.candidate.sources = (result.candidate.sources || [])
    .flatMap((source) => {
      const item = evidenceByUrl.get(source?.url);
      if (!item) return [];
      return [
        {
          title: item.title || item.url,
          url: item.url,
          type: 'official_community',
          claims: Array.isArray(source.claims)
            ? source.claims.filter((claim) => typeof claim === 'string')
            : [],
          checked_at: item.checked_at,
        },
      ];
    });

  const guard = enforceBilibiliEvidence(currentGame, result.candidate, evidence);
  result.candidate = guard.candidate;
  if (guard.reverted.length) {
    result.notes.push(`前瞻字段缺少对应 Bilibili 官方前瞻 evidence，保留旧值: ${guard.reverted.join('、')}`);
  }

  if (result.candidate.preview_start_at) {
    const previewTime = Date.parse(result.candidate.preview_start_at);
    if (Number.isFinite(previewTime)) {
      const normalizedStatus = previewTime > Date.now() ? '已官宣待发布' : '已发布';
      if (result.candidate.preview_status !== normalizedStatus) {
        result.candidate.preview_status = normalizedStatus;
        result.notes.push(`按已核验开播时间校正前瞻状态为${normalizedStatus}`);
      }
    }
  }

  const evidenceUrls = new Set(evidence.map((item) => item.url));
  validateGame(result.candidate, { evidenceUrls, requireEvidenceSources: true });
  return {
    ...result,
    changed: hasMeaningfulChange(currentGame, result.candidate),
  };
}

async function writeReport(report) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function writeGithubSummary(report) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  const lines = [
    '# Game Version Tracker AI Agent',
    '',
    `- Model: \`${report.model}\``,
    `- Provider: \`${report.provider}\``,
    `- Gateway session: \`${report.gateway_session}\``,
    `- review-agent: **${report.approved ? 'APPROVED' : 'REJECTED'}**`,
    `- Dry run: \`${report.dry_run}\``,
    `- Fact changes: ${report.changed_games?.length ? report.changed_games.join('、') : '无'}`,
    `- Dataset changed: \`${report.dataset_changed}\``,
    '',
    '## child-agents',
    '',
    '| 游戏 | 状态 | 证据页 | 事实变化 |',
    '|---|---:|---:|---:|',
    ...GAME_NAMES.map((name) => {
      const child = report.children?.find((item) => item.game_name === name);
      return `| ${name} | ${child?.verification_status || 'error'} | ${child?.evidence_count ?? 0} | ${child?.meaningful_change ? '是' : '否'} |`;
    }),
    '',
  ];
  if (report.mechanical_issues?.length) {
    lines.push('## 程序化预审问题', '', ...report.mechanical_issues.map((issue) => `- ${issue}`), '');
  }
  if (report.review?.issues?.length) {
    lines.push('## review-agent 问题', '', ...report.review.issues.map((issue) => `- ${issue}`), '');
  }
  await appendFile(target, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const currentDataset = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  validateDataset(currentDataset);

  const runner = await createLlmRunner();
  let collector;
  try {
    log(`模型: ${runner.model}`);
    log(`Zen endpoint: ${runner.baseUrl}`);
    log(`x-opencode-session: ${runner.gatewaySession}`);
    log(`main-agent 正在读取仓库摘要并生成 ${GAME_NAMES.length} 个子任务…`);

    const planCall = await callJson(runner, 'main-agent', mainPlanPrompt(currentDataset));
    const assignments = planCall.value.assignments;
    validateAssignments(assignments);
    log(`main-agent 已完成任务分配，cli-session=${planCall.cliSessionId || 'n/a'}`);

    collector = await createEvidenceCollector();
    const evidenceByGame = {};
    const childResults = [];
    const childReport = [];

    for (let index = 0; index < GAME_NAMES.length; index += 1) {
      const gameName = GAME_NAMES[index];
      const assignment = assignments.find((item) => item.game_name === gameName);
      const currentGame = currentDataset.games.find((game) => game.game_name === gameName);
      log(`[${index + 1}/${GAME_NAMES.length}] search-worker 读取 Bilibili 官方账号 ${gameName}…`);
      const evidence = await collector.collect(assignment, currentGame);
      evidenceByGame[gameName] = evidence;
      log(`[${index + 1}/${GAME_NAMES.length}] ${gameName} 读取 ${evidence.length} 条 Bilibili 官方 evidence；启动 child-agent…`);

      try {
        const childCall = await callJson(runner, `child-agent:${gameName}`, childPrompt({ assignment, currentGame, evidence }));
        const result = normalizeChildResult(childCall.value, gameName, currentGame, evidence);
        childResults.push(result);
        childReport.push({
          game_name: gameName,
          verification_status: result.verification_status,
          evidence_count: evidence.length,
          meaningful_change: result.changed,
          cli_session: childCall.cliSessionId,
          notes: result.notes,
        });
      } catch (error) {
        childResults.push({
          game_name: gameName,
          verification_status: 'insufficient',
          changed: false,
          candidate: currentGame,
          notes: [`child-agent 失败: ${error.message}`],
        });
        childReport.push({
          game_name: gameName,
          verification_status: 'insufficient',
          evidence_count: evidence.length,
          meaningful_change: false,
          cli_session: null,
          notes: [`child-agent 失败: ${error.message}`],
        });
      }
    }

    await collector.close();
    collector = null;

    const proposedDataset = structuredClone(currentDataset);
    const changedGames = [];
    const sourceMigratedGames = [];
    const verifiedGames = new Set();
    for (const gameName of GAME_NAMES) {
      const currentGame = currentDataset.games.find((game) => game.game_name === gameName);
      const result = childResults.find((item) => item.game_name === gameName);
      if (!result || result.verification_status !== 'verified') continue;
      verifiedGames.add(gameName);
      const factChanged = hasMeaningfulChange(currentGame, result.candidate);
      const sourcesChanged = hasMeaningfulSourceChange(currentGame, result.candidate);
      if (!factChanged && !sourcesChanged) continue;
      const index = proposedDataset.games.findIndex((game) => game.game_name === gameName);
      proposedDataset.games[index] = result.candidate;
      if (factChanged) changedGames.push(gameName);
      if (sourcesChanged) sourceMigratedGames.push(gameName);
    }
    const mediaPlan = buildPreviewMediaPlan(proposedDataset, evidenceByGame, verifiedGames);
    validateDataset(proposedDataset);

    const mechanicalIssues = collectReviewIssues({
      currentDataset,
      proposedDataset,
      childResults,
      evidenceByGame,
    });
    const allVerified = GAME_NAMES.every((gameName) => {
      const child = childResults.find((item) => item.game_name === gameName);
      return child?.verification_status === 'verified' && (evidenceByGame[gameName] || []).length > 0;
    });
    const allChildrenReturned = GAME_NAMES.every((gameName) => {
      const child = childReport.find((item) => item.game_name === gameName);
      return child && child.cli_session;
    });
    const insufficientGames = childReport
      .filter((item) => item.verification_status === 'insufficient')
      .map((item) => item.game_name);

    log(
      `child-agent 调用完整=${allChildrenReturned}；all_verified=${allVerified}；` +
        `安全降级=${insufficientGames.length ? insufficientGames.join('、') : '无'}；启动独立 review-agent…`,
    );
    const reviewCall = await callJson(
      runner,
      'review-agent',
      reviewPrompt({
        currentDataset,
        proposedDataset,
        childResults,
        evidenceSummary: evidenceSummary(evidenceByGame),
        mechanicalIssues,
      }),
    );
    const review = reviewCall.value;
    const approved = review?.approved === true && allChildrenReturned && mechanicalIssues.length === 0;
    let mediaResults = [];
    if (approved && !dryRun) {
      mediaResults = await materializePreviewMedia(proposedDataset, mediaPlan);
      validateDataset(proposedDataset);
    }
    const datasetChanged = JSON.stringify(currentDataset) !== JSON.stringify(proposedDataset);

    const report = {
      started_from: process.env.GITHUB_SHA || null,
      finished_at: new Date().toISOString(),
      model: runner.model,
      provider: runner.provider,
      endpoint: runner.baseUrl,
      gateway_session: runner.gatewaySession,
      main_cli_session: planCall.cliSessionId,
      review_cli_session: reviewCall.cliSessionId,
      dry_run: dryRun,
      approved,
      all_verified: allVerified,
      all_children_returned: allChildrenReturned,
      insufficient_games: insufficientGames,
      dataset_changed: datasetChanged,
      changed_games: changedGames,
      source_migrated_games: sourceMigratedGames,
      preview_media_plan: mediaPlan.map((entry) => ({
        game_name: entry.game_name,
        dynamic_id: entry.dynamic_id,
        image_count: entry.items.length,
      })),
      preview_media_results: mediaResults,
      mechanical_issues: mechanicalIssues,
      review,
      children: childReport,
      evidence: evidenceSummary(evidenceByGame),
      proposed_dataset: proposedDataset,
    };
    await writeReport(report);
    await writeGithubSummary(report);

    if (!approved) {
      throw new Error(`review-agent 未批准本轮写入: ${JSON.stringify([...mechanicalIssues, ...(review?.issues || [])])}`);
    }

    if (!datasetChanged) {
      log('review-agent 已批准；候选数据与仓库完全一致，不写文件、不产生空提交。');
      return;
    }

    if (dryRun) {
      log(
        `review-agent 已批准；dry-run 不写 games.json/media。事实变化: ${changedGames.length ? changedGames.join('、') : '无'}；` +
          `来源迁移: ${sourceMigratedGames.length ? sourceMigratedGames.join('、') : '无'}；` +
          `前瞻配图计划: ${mediaPlan.reduce((count, entry) => count + entry.items.length, 0)} 张`,
      );
      return;
    }

    await writeFile(DATA_PATH, `${JSON.stringify(proposedDataset, null, 2)}\n`, 'utf8');
    log(
      `review-agent 已批准，已写入 data/games.json。事实变化: ${changedGames.length ? changedGames.join('、') : '无'}；` +
        `来源迁移: ${sourceMigratedGames.length ? sourceMigratedGames.join('、') : '无'}；` +
        `已发布前瞻配图: ${mediaResults.reduce((count, item) => count + item.published, 0)} 张`,
    );
  } finally {
    await collector?.close().catch(() => {});
    await runner.close().catch(() => {});
  }
}

main().catch(async (error) => {
  console.error(`[agent] ERROR: ${error.stack || error.message}`);
  try {
    const existing = await readFile(REPORT_PATH, 'utf8').catch(() => null);
    if (!existing) {
      await writeReport({
        finished_at: new Date().toISOString(),
        dry_run: dryRun,
        approved: false,
        fatal_error: error.message,
      });
    }
  } catch {
    // Preserve the original failure as the workflow result.
  }
  process.exitCode = 1;
});
