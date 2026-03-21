import { spawn } from 'node:child_process';
import chalk from 'chalk';

const CONVENTIONAL_COMMIT_PATTERN = /^[a-z]+\([^\)]+\):\s.+$/;
const REQUEST_TIMEOUT_MS = 15000;

export function createLlmService(config = {}) {
  const safeConfig = {
    enabled: Boolean(config.enabled),
    provider: config.provider || 'ollama',
    model: config.model || 'glm-4.7-flash',
    temperature: typeof config.temperature === 'number' ? config.temperature : 0.2,
    endpoint: config.endpoint || 'http://localhost:11434',
    command: config.command || null
  };

  async function generateCommitMessage(diff, commitMeta, defaultMessage) {
    if (!safeConfig.enabled) {
      return defaultMessage;
    }

    if (!diff || !diff.trim()) {
      console.warn(chalk.yellow('LLM: empty diff supplied, falling back to rule-based message.'));
      return defaultMessage;
    }

    try {
      if (safeConfig.provider === 'ollama') {
        return await generateViaOllama(diff, defaultMessage, commitMeta, safeConfig);
      }

      if (safeConfig.provider === 'command' && safeConfig.command) {
        return await generateViaCommand(diff, defaultMessage, safeConfig.command);
      }

      console.warn(chalk.yellow(`LLM: Unknown provider "${safeConfig.provider}". Falling back.`));
      return defaultMessage;
    } catch (error) {
      console.warn(chalk.yellow(`LLM provider failed: ${error.message}. Falling back to rule-based message.`));
      return defaultMessage;
    }
  }

  return {
    isEnabled: () => safeConfig.enabled,
    generateCommitMessage
  };
}

async function generateViaOllama(diff, fallback, commitMeta, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = new URL('/api/generate', config.endpoint).toString();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt: buildPrompt(commitMeta, diff),
        stream: false,
        options: { temperature: clampTemperature(config.temperature) }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    return sanitizeCommitMessage(payload?.response, fallback);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('timed out while contacting Ollama');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function generateViaCommand(diff, fallback, command) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true });
    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        const cleaned = sanitizeCommitMessage(output, fallback);
        if (cleaned) {
          resolve(cleaned);
          return;
        }
      }

      if (errorOutput) {
        console.warn(chalk.yellow(`LLM command stderr: ${errorOutput.trim()}`));
      }

      resolve(fallback);
    });

    child.on('error', () => resolve(fallback));
    child.stdin.write(diff);
    child.stdin.end();
  });
}

function buildPrompt(commitMeta, diff) {
  const fileList = (commitMeta?.files || [])
    .map((file) => `- ${file.path} (${file.change})`)
    .join('\n');

  return [
    'You are an expert release engineer who writes precise Conventional Commit subjects.',
    'Return exactly one line using the form type(scope): short description.',
    'Use lowercase types (feat, fix, refactor, docs, style, config, test).',
    'Keep it under 70 characters and prefer imperative verbs.',
    '',
    `Planned type: ${commitMeta?.type || 'unknown'}`,
    `Planned scope: ${commitMeta?.scope || 'root'}`,
    `Rule-based suggestion: ${commitMeta?.message || 'n/a'}`,
    '',
    'Changed files:',
    fileList || '- (files omitted)',
    '',
    'Git diff:',
    diff,
    '',
    'Respond with the commit subject only.'
  ].join('\n');
}

function sanitizeCommitMessage(raw, fallback) {
  if (!raw) {
    return fallback;
  }

  const candidate = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!candidate) {
    return fallback;
  }

  if (!CONVENTIONAL_COMMIT_PATTERN.test(candidate)) {
    return fallback;
  }

  return candidate.length > 120 ? `${candidate.slice(0, 117)}...` : candidate;
}

function clampTemperature(value) {
  if (!Number.isFinite(value)) {
    return 0.2;
  }
  return Math.min(Math.max(value, 0), 1);
}
