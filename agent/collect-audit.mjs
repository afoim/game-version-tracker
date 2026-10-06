import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createEvidenceCollector } from './lib/browser.mjs';

// Read-only audit: use the production collector and existing Actions credentials,
// but never invoke the model, change published data, or export private headers.
const dataset = JSON.parse(await readFile('data/games.json', 'utf8'));
const collector = await createEvidenceCollector();
const results = {};
try {
  for (let index = 0; index < dataset.games.length; index += 4) {
    await Promise.all(dataset.games.slice(index, index + 4).map(async game => {
      const evidence = await collector.collect({}, game);
      results[game.game_name] = evidence;
      console.log(`${game.game_name}: ${evidence.length} official sources`);
    }));
  }
} finally {
  await mkdir('agent-output', { recursive: true });
  await writeFile('agent-output/evidence-audit.json', JSON.stringify({
    collected_at: new Date().toISOString(), diagnostics: collector.diagnostics, evidence: results,
  }, null, 2));
  await collector.close();
}
if (dataset.games.some(game => !results[game.game_name]?.length)) {
  throw new Error('Official evidence missing for one or more games; inspect evidence-audit.json');
}
