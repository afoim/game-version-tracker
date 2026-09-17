import { readFile } from 'node:fs/promises';
import { validateDataset } from './lib/validate.mjs';

const dataset = JSON.parse(await readFile(new URL('../data/games.json', import.meta.url), 'utf8'));
validateDataset(dataset);
console.log(`data/games.json valid: ${dataset.games.length} games`);
