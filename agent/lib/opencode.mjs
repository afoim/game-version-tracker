import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MODEL_ID = process.env.AGENT_MODEL || 'muse-spark-1.3-contributor-free';
const PROVIDER_ID = 'opencode';
const BASE_URL = process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1';
const API_KEY = process.env.OPENCODE_API_KEY || 'public';
const CALL_TIMEOUT_MS = Number(process.env.AGENT_LLM_TIMEOUT_MS || 240000);

function resolveGatewaySession() {
  const explicit = process.env.AGENT_SESSION_ID?.trim();
  if (explicit) return explicit;
  const runId = process.env.GITHUB_RUN_ID?.trim();
  if (runId) return `game-version-tracker-${runId}`;
  return `game-version-tracker-local-${process.pid}-${Date.now()}`;
}

function localBinary() {
  if (process.platform === 'win32') {
    const native = path.resolve('node_modules', 'opencode-ai', 'bin', 'opencode.exe');
    if (existsSync(native)) return native;
    return 'opencode.exe';
  }
  const shim = path.resolve('node_modules', '.bin', 'opencode');
  if (existsSync(shim)) return shim;
  return 'opencode';
}

function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Ignore non-event output from the CLI.
    }
  }

  const textEvents = events.filter((event) => event.type === 'text' && typeof event.part?.text === 'string');
  // With -f, OpenCode may emit a short commentary text before using its file-read
  // tool, then emit the actual answer in a later step. Only the last text event
  // is the completed answer we asked for.
  const text = textEvents.at(-1)?.part?.text ?? '';
  const cliSessionId = events.find((event) => event.sessionID)?.sessionID ?? null;
  return { events, text, cliSessionId };
}

function createConfig(gatewaySession) {
  return {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      [PROVIDER_ID]: {
        options: {
          baseURL: BASE_URL,
          apiKey: API_KEY,
          headers: {
            'x-opencode-session': gatewaySession,
          },
        },
      },
    },
    model: `${PROVIDER_ID}/${MODEL_ID}`,
  };
}

export async function createLlmRunner() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'game-version-agent-llm-'));
  const binary = localBinary();
  const gatewaySession = resolveGatewaySession();
  await writeFile(path.join(cwd, 'opencode.json'), `${JSON.stringify(createConfig(gatewaySession), null, 2)}\n`, 'utf8');

  async function run(prompt, options = {}) {
    const promptPath = path.join(cwd, `prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    await writeFile(promptPath, String(prompt), 'utf8');
    const args = [
      'run',
      '--pure',
      '--format',
      'json',
      '-m',
      `${PROVIDER_ID}/${options.model || MODEL_ID}`,
      'Read the attached UTF-8 text file as the complete task. Follow it exactly and return only the requested answer.',
      '-f',
      promptPath,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        cwd,
        env: {
          ...process.env,
          NO_COLOR: '1',
          OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
        },
        windowsHide: true,
        shell: false,
        // OpenCode reads stdin when it is an open pipe. Node's default spawn()
        // keeps that pipe open, causing headless CI calls to wait forever even
        // though the prompt was supplied by -f. Close stdin explicitly.
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill();
      }, options.timeoutMs || CALL_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        rm(promptPath, { force: true }).catch(() => {});
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        rm(promptPath, { force: true }).catch(() => {});
        if (killed) {
          reject(new Error(`OpenCode 调用超时 (${options.timeoutMs || CALL_TIMEOUT_MS}ms)`));
          return;
        }
        if (code !== 0) {
          reject(new Error(`OpenCode 退出码 ${code}: ${stderr.slice(-4000)}\n${stdout.slice(-2500)}`));
          return;
        }
        const parsed = parseEvents(stdout);
        if (!parsed.text) {
          reject(new Error(`OpenCode 没有返回文本事件。stdout=${stdout.slice(-3500)}`));
          return;
        }
        resolve({ ...parsed, stdout, stderr });
      });
    });
  }

  async function close() {
    await rm(cwd, { recursive: true, force: true });
  }

  return {
    run,
    close,
    model: MODEL_ID,
    provider: PROVIDER_ID,
    baseUrl: BASE_URL,
    gatewaySession,
  };
}
