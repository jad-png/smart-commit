import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CONFIG = {
  interactive: true,
  includeStaged: true,
  scopeDepth: 1,
  maxFilesPerCommit: Infinity,
  typeOverrides: [],
  ignorePatterns: [],
  ai: { command: null }
};

const CANDIDATE_FILES = ['smartcommit.config.json', '.smartcommitrc', '.smartcommitrc.json'];

export async function loadConfig(explicitPath, cwd = process.cwd()) {
  const searchQueue = buildSearchQueue(explicitPath, cwd);

  for (const candidate of searchQueue) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw);
      return normalizeConfig(parsed, candidate);
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }

      if (error instanceof SyntaxError) {
        throw new Error(`Unable to parse config file at ${candidate}: ${error.message}`);
      }

      throw error;
    }
  }

  return normalizeConfig({}, null);
}

function buildSearchQueue(explicitPath, cwd) {
  if (explicitPath) {
    const resolved = path.isAbsolute(explicitPath) ? explicitPath : path.join(cwd, explicitPath);
    return [resolved];
  }

  return CANDIDATE_FILES.map((fileName) => path.join(cwd, fileName));
}

function normalizeConfig(rawConfig = {}, sourcePath) {
  const normalized = { ...DEFAULT_CONFIG, __source: sourcePath };

  if (typeof rawConfig.interactive === 'boolean') {
    normalized.interactive = rawConfig.interactive;
  }

  if (typeof rawConfig.includeStaged === 'boolean') {
    normalized.includeStaged = rawConfig.includeStaged;
  }

  if (Number.isFinite(rawConfig.scopeDepth) && rawConfig.scopeDepth > 0) {
    normalized.scopeDepth = rawConfig.scopeDepth;
  }

  if (Number.isFinite(rawConfig.maxFilesPerCommit) && rawConfig.maxFilesPerCommit > 0) {
    normalized.maxFilesPerCommit = rawConfig.maxFilesPerCommit;
  }

  if (Array.isArray(rawConfig.typeOverrides)) {
    normalized.typeOverrides = rawConfig.typeOverrides
      .map(mapTypeOverride)
      .filter(Boolean);
  }

  if (Array.isArray(rawConfig.ignorePatterns)) {
    normalized.ignorePatterns = rawConfig.ignorePatterns
      .map(mapPattern)
      .filter(Boolean);
  }

  if (rawConfig.ai && typeof rawConfig.ai === 'object') {
    normalized.ai = {
      command: typeof rawConfig.ai.command === 'string' ? rawConfig.ai.command : null
    };
  }

  return normalized;
}

function mapTypeOverride(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  if (typeof entry.pattern !== 'string' || typeof entry.type !== 'string') {
    return null;
  }

  try {
    return {
      pattern: entry.pattern,
      regex: new RegExp(entry.pattern),
      type: entry.type.trim(),
      scope: typeof entry.scope === 'string' ? entry.scope.trim() : null
    };
  } catch (error) {
    console.warn(`Skipping invalid regex in typeOverrides: ${entry.pattern}`);
    return null;
  }
}

function mapPattern(pattern) {
  if (typeof pattern !== 'string') {
    return null;
  }

  try {
    return new RegExp(pattern);
  } catch (error) {
    console.warn(`Skipping invalid ignore pattern: ${pattern}`);
    return null;
  }
}

export const defaultConfig = DEFAULT_CONFIG;
