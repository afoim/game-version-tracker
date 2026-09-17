import { readFile } from 'node:fs/promises';
import { validateMediaFeed } from './lib/media-feed.mjs';
import { validateDataset } from './lib/validate.mjs';

const dataset = JSON.parse(await readFile(new URL('../data/games.json', import.meta.url), 'utf8'));
validateDataset(dataset);
console.log(`data/games.json valid: ${dataset.games.length} games`);

const mediaFeedText = await readFile(new URL('../data/media-feed.json', import.meta.url), 'utf8').catch((error) => {
  if (error?.code === 'ENOENT') return null;
  throw error;
});
if (mediaFeedText) {
  const mediaFeed = JSON.parse(mediaFeedText);
  validateMediaFeed(mediaFeed);
  console.log(`data/media-feed.json valid: ${mediaFeed.media.items.length} media items`);
}
