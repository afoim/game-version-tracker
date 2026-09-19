import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadImage } from '../agent/lib/download-image.mjs';

test('image downloads are bounded and release rejected streams', async (t) => {
  const originalFetch = globalThis.fetch;
  try {
    await t.test('preserves downloaded bytes', async () => {
      globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
      assert.deepEqual(await downloadImage('https://i0.hdslb.com/image.png'), Buffer.from([1, 2, 3]));
    });
    await t.test('rejects lookalike domains before requesting', async () => {
      globalThis.fetch = async () => { throw new Error('fetch must not be reached'); };
      await assert.rejects(downloadImage('https://evilhdslb.com/image.png'), /非 Bilibili/);
    });
    await t.test('oversized streams stop before downloading their full body', async () => {
      let pulls = 0;
      let cancelled = false;
      globalThis.fetch = async () => new Response(new ReadableStream({
        pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)); },
        cancel() { cancelled = true; },
      }));
      await assert.rejects(downloadImage('https://i0.hdslb.com/image.png'), /超过/);
      assert.ok(pulls <= 17);
      assert.equal(cancelled, true);
    });
    await t.test('timeout covers stalled body reads, not just response headers', async () => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let ready;
      const started = new Promise(resolve => { ready = resolve; });
      globalThis.fetch = async (_url, { signal }) => new Response(new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
          ready();
        },
      }));
      const pending = downloadImage('https://i0.hdslb.com/image.png');
      const rejection = assert.rejects(pending, { name: 'AbortError' });
      await started;
      t.mock.timers.tick(20_001);
      await rejection;
      t.mock.timers.reset();
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
