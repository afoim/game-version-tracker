import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createEvidenceCollector } from './lib/browser.mjs';
import { buildMediaFeed, validateMediaFeed } from './lib/media-feed.mjs';
import { downloadImage } from './lib/download-image.mjs';

const read = async file => JSON.parse(await readFile(file, 'utf8'));
const dataset = await read('data/games.json');
const prior = await read('agent-output/evidence-audit.json').catch(() => ({ evidence: {} }));
const previousFeed = await read('data/media-feed.json');
const collector = await createEvidenceCollector();
const evidence = {}, mediaByGame = {}, failures = [];
try {
  // Bilibili is a separate deterministic collection batch; no model here.
  for (let index = 0; index < dataset.games.length; index += 2) {
    await Promise.all(dataset.games.slice(index, index + 2).map(async game => {
      const name = game.game_name;
      const fresh = await collector.collect({}, game).catch(() => []);
      mediaByGame[name] = await collector.collectMedia(game).catch(() => []);
      if (!fresh.length) failures.push(name);
      const merged = new Map((prior.evidence[name] || []).map(item => [item.url, item]));
      for (const item of fresh) merged.set(item.url, item);
      evidence[name] = [...merged.values()].sort((a, b) => Date.parse(b.published_at || b.checked_at) - Date.parse(a.published_at || a.checked_at)).slice(0, 300);
      console.log(`[bilibili] ${name}: ${fresh.length} fresh sources, ${evidence[name].length} cached sources, ${mediaByGame[name].length} uploads`);
    }));
  }
  const { feed, coverPlan } = buildMediaFeed({ dataset, mediaByGame, baseUrl: process.env.GAME_DATA_BASE_URL || 'https://game-version-tracker.pages.dev' });
  for (const game of dataset.games) {
    if (!feed.media.items.some(item => item.game_name === game.game_name)) {
      feed.media.items.push(...previousFeed.media.items.filter(item => item.game_name === game.game_name));
    }
  }
  for (const item of coverPlan) {
    const target = path.join('data', item.relative_path);
    try {
      await access(target).catch(async () => {
        const bytes = await downloadImage(item.remote_url);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
      });
    } catch {
      const media = feed.media.items.find(media => media.id === item.id);
      if (media) media.poster_url = null;
    }
  }
  validateMediaFeed(feed);
  await mkdir('agent-output', { recursive: true });
  await writeFile('agent-output/bili-media-feed.json', JSON.stringify(feed, null, 2));
  await writeFile('agent-output/evidence-audit.json', JSON.stringify({ collected_at: new Date().toISOString(), diagnostics: collector.diagnostics, evidence, failures, raw_dynamics: collector.rawDynamics }, null, 2));
} finally {
  await collector.close();
}
