import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createEvidenceCollector } from './lib/browser.mjs';
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
const OUTPUT_DIR = path.join(ROOT, 'agent-output');
const REPORT_PATH = path.join(OUTPUT_DIR, 'report.json');
const dryRun = process.argv.includes('--dry-run') || process.env.AGENT_DRY_RUN === 'true';

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
        excerpt: item.text.slice(0, 2200),
      })),
    ]),
  );
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
    log('main-agent 正在读取仓库摘要并生成 9 个子任务…');

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
      log(`[${index + 1}/9] search-worker 使用 Playwright 核验 ${gameName}…`);
      const evidence = await collector.collect(assignment, currentGame);
      evidenceByGame[gameName] = evidence;
      log(`[${index + 1}/9] ${gameName} 成功读取 ${evidence.length} 个外部页面；启动 child-agent…`);

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
    for (const gameName of GAME_NAMES) {
      const currentGame = currentDataset.games.find((game) => game.game_name === gameName);
      const result = childResults.find((item) => item.game_name === gameName);
      if (!result || result.verification_status !== 'verified') continue;
      if (!hasMeaningfulChange(currentGame, result.candidate)) continue;
      const index = proposedDataset.games.findIndex((game) => game.game_name === gameName);
      proposedDataset.games[index] = result.candidate;
      changedGames.push(gameName);
    }
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
      log(`review-agent 已批准；dry-run 不写 games.json。事实变化: ${changedGames.length ? changedGames.join('、') : '无，仅来源/核验时间刷新'}`);
      return;
    }

    await writeFile(DATA_PATH, `${JSON.stringify(proposedDataset, null, 2)}\n`, 'utf8');
    log(`review-agent 已批准，已写入 data/games.json。事实变化: ${changedGames.length ? changedGames.join('、') : '无，仅来源/核验时间刷新'}`);
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
