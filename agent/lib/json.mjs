export function extractJson(text) {
  const source = String(text ?? '').trim();
  if (!source) throw new Error('模型没有返回文本');

  const unfenced = source
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    // Continue with a balanced-brace scan. Models occasionally add one short sentence
    // around an otherwise valid JSON object.
  }

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (start < 0) {
      if (ch !== '{' && ch !== '[') continue;
      start = i;
      depth = 1;
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;

    if (depth === 0) {
      const candidate = source.slice(start, i + 1);
      try {
        return JSON.parse(candidate);
      } catch (error) {
        throw new Error(`模型返回中找到了 JSON 外形，但解析失败: ${error.message}`);
      }
    }
  }

  throw new Error(`无法从模型输出解析 JSON: ${source.slice(0, 500)}`);
}
