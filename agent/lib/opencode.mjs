import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const MODEL_ID = process.env.AGENT_MODEL || 'deepseek-v4-1-flash-260910';
const PROVIDER_ID = process.env.AGENT_PROVIDER_ID || 'opencode';
const PROVIDER_NPM = process.env.AGENT_PROVIDER_NPM || '';
const PROVIDER_NAME = process.env.AGENT_PROVIDER_NAME || PROVIDER_ID;
const BASE_URL =
  process.env.AGENT_LLM_BASE_URL || process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1';
const API_KEY = process.env.AGENT_LLM_API_KEY || process.env.OPENCODE_API_KEY || 'public';
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

  const text = events
    .filter((event) => event.type === 'text' && typeof event.part?.text === 'string')
    .map((event) => event.part.text)
    .join('\n');
  const cliSessionId = events.find((event) => event.sessionID)?.sessionID ?? null;
  return { events, text, cliSessionId };
}

function createConfig(gatewaySession) {
  const provider = {
    options: {
      baseURL: BASE_URL,
      apiKey: API_KEY,
    },
  };
  if (PROVIDER_NPM) {
    provider.npm = PROVIDER_NPM;
    provider.name = PROVIDER_NAME;
    provider.models = { [MODEL_ID]: { name: MODEL_ID } };
  }
  if (PROVIDER_ID === 'opencode') {
    provider.options.headers = { 'x-opencode-session': gatewaySession };
  }
  return {
    $schema: 'https://opencode.ai/config.json',
    // Model calls are reasoning-only. Search is owned by Playwright and all
    // repository writes are owned by the orchestrator after review approval.
    // Denying every OpenCode tool makes that separation enforceable instead of
    // relying only on the child/reviewer prompts.
    permission: {
      '*': 'deny',
    },
    provider: {
      [PROVIDER_ID]: provider,
    },
    model: `${PROVIDER_ID}/${MODEL_ID}`,
  };
}

export async function createLlmRunner() {
  const binary = localBinary();
  const gatewaySession = resolveGatewaySession();
  const configContent = JSON.stringify(createConfig(gatewaySession));

  async function run(prompt, options = {}) {
    const args = [
      'run',
      '--pure',
      '--format',
      'json',
      '-m',
      `${PROVIDER_ID}/${options.model || MODEL_ID}`,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        // Keep OpenCode inside the checked-out repository so its built-in Zen
        // provider initializes exactly as it does in normal CLI usage.
        cwd: process.cwd(),
        env: {
          ...process.env,
          NO_COLOR: '1',
          OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
          // Override only this invocation. The free model remains invoked from
          // inside OpenCode while Zen and the run-scoped session are explicit.
          OPENCODE_CONFIG_CONTENT: configContent,
        },
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
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
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed) {
          reject(
            new Error(
              `OpenCode 调用超时 (${options.timeoutMs || CALL_TIMEOUT_MS}ms). stderr=${stderr.slice(-1200)} stdout=${stdout.slice(-1200)}`,
            ),
          );
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

      // `opencode run` accepts its message from stdin. Closing stdin immediately
      // after the complete prompt avoids both the old CI deadlock and the `-f`
      // attachment/tool-read commentary that can corrupt structured JSON output.
      child.stdin.end(String(prompt), 'utf8');
    });
  }

  async function close() {
    // Kept for the runner interface; there is no persistent process or temp dir.
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
