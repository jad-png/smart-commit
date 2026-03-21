import { spawn } from 'node:child_process';
import chalk from 'chalk';

const COMMIT_PATTERN = /^(feat|fix|refactor|docs|style|config|test)\(.+\): .+/;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_SUBJECT_LENGTH = 72;

export function createLlmService(config = {}) {
  const safeConfig = {
    enabled: Boolean(config.enabled),
    provider: config.provider || 'ollama',
    model: config.model || 'phi3',
    temperature: typeof config.temperature === 'number' ? config.temperature : 0.1,
    endpoint: config.endpoint || 'http://localhost:11434',
    command: config.command || null
  };

  async function generateCommitMessage(diff, commitMeta = {}) {
    if (!safeConfig.enabled) {
      throw new Error('AI commit generation is disabled.');
    }

    if (!diff || !diff.trim()) {
      throw new Error('LLM requires diff context to craft the commit subject.');
    }

    const prompt = buildPrompt(commitMeta, diff);
    const firstTry = await dispatchPrompt(prompt);
    const cleanedFirst = cleanCommitSubject(firstTry);

    if (isValidCommitSubject(cleanedFirst)) {
      return enforceLength(cleanedFirst);
    }

    const correctionPrompt = [
      prompt,
      '',
      'Correction: Respond with exactly one line formatted as type(scope): description using lowercase types only.',
      'Use plain English that summarizes behavior change. Do not copy code, symbols, or raw diff lines.'
    ].join('\n');

    const secondTry = await dispatchPrompt(correctionPrompt);
    const cleanedSecond = cleanCommitSubject(secondTry);

    if (isValidCommitSubject(cleanedSecond)) {
      return enforceLength(cleanedSecond);
    }

    throw new Error('LLM returned an invalid commit subject after a correction attempt.');
  }

  function dispatchPrompt(prompt) {
    if (safeConfig.provider === 'ollama') {
      return generateViaOllama(prompt, safeConfig);
    }

    if (safeConfig.provider === 'command' && safeConfig.command) {
      return generateViaCommand(prompt, safeConfig.command);
    }

    throw new Error(`Unknown LLM provider "${safeConfig.provider}".`);
  }

  return {
    isEnabled: () => safeConfig.enabled,
    generateCommitMessage
  };
}

async function generateViaOllama(prompt, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = new URL('/api/generate', config.endpoint).toString();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt,
        stream: false,
        options: { temperature: clampTemperature(config.temperature) }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    return payload?.response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('timed out while contacting Ollama');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function generateViaCommand(prompt, command) {
  return new Promise((resolve, reject) => {
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
        resolve(output);
        return;
      }

      const errorMessage = errorOutput.trim() || `LLM command exited with code ${code}`;
      reject(new Error(errorMessage));
    });

    child.on('error', (error) => reject(error));
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function buildPrompt(commitMeta, diff) {
  const files = Array.isArray(commitMeta?.files) ? commitMeta.files : [];
  const fileList = files.length
    ? files.map((file) => `- ${file.path} (${file.change || 'modified'})`).join('\n')
    : '- (files omitted)';
  const filesLine = files.length ? `Files:\n${fileList}` : `Files: ${fileList}`;

  return [
    '[Context]',
    `Type: ${commitMeta?.plannedType || commitMeta?.type || 'unknown'}`,
    `Scope: ${commitMeta?.plannedScope || commitMeta?.scope || 'root'}`,
    filesLine,
    '',
    '[Diff]',
    diff.trim(),
    '',
    'Instruction: Write the commit subject line following the type(scope): description format. Use imperative mood.',
    'Instruction: Summarize what changed in plain language. Do not quote code or paste diff snippets.',
    'Instruction: Respond ONLY with the line.'
  ].join('\n');
}

function cleanCommitSubject(raw) {
  if (!raw) {
    return null;
  }

  const candidateLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!candidateLine) {
    return null;
  }

  let cleaned = candidateLine.replace(/`/g, '').trim();
  cleaned = cleaned.replace(/^output[:\-]?\s*/i, '').trim();
  cleaned = cleaned.replace(/\.+$/, '').trim();

  return cleaned || null;
}

function isValidCommitSubject(candidate) {
  if (!candidate) {
    return false;
  }
  if (!COMMIT_PATTERN.test(candidate)) {
    return false;
  }

  return !isCodeLikeCommit(candidate);
}

function isCodeLikeCommit(candidate) {
  const [, description = ''] = candidate.split(':');
  const lowered = description.toLowerCase();

  if (!description.trim()) {
    return true;
  }

  const codePatterns = [
    /[{};`]/,
    /=>/,
    /\b(import|export|const|let|var|function|class|return)\b/,
    /\w+\(.*\)/,
    /\bif\s*\(|\bfor\s*\(|\bwhile\s*\(/
  ];

  return codePatterns.some((pattern) => pattern.test(lowered));
}

function enforceLength(candidate) {
  if (candidate.length <= MAX_SUBJECT_LENGTH) {
    return candidate;
  }

  console.warn(chalk.yellow(`LLM subject exceeded ${MAX_SUBJECT_LENGTH} characters. Truncating.`));
  return candidate.slice(0, MAX_SUBJECT_LENGTH);
}

function clampTemperature(value) {
  if (!Number.isFinite(value)) {
    return 0.1;
  }
  return Math.min(Math.max(value, 0), 1);
}
