const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export async function downloadImage(remoteUrl) {
  const url = new URL(remoteUrl);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !(url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com'))) {
    throw new Error('非 Bilibili CDN 图片');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let reader;
  try {
    const response = await fetch(url, {
      headers: {
        Referer: 'https://www.bilibili.com/',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES)
      throw new Error('图片超过 15 MiB');
    if (!response.body) throw new Error('图片内容为空');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error('图片超过 15 MiB');
      chunks.push(value);
    }
    if (!size) throw new Error('图片内容为空');
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
