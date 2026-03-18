import path from 'node:path';

const STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.styl', '.pcss'];
const DOC_EXTENSIONS = ['.md', '.mdx', '.rst', '.adoc', '.txt'];
const CONFIG_EXTENSIONS = ['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.env', '.conf', '.config', '.cfg'];
const TEST_EXTENSIONS = ['.test.js', '.test.ts', '.spec.js', '.spec.ts', '.test.jsx', '.test.tsx', '.spec.jsx', '.spec.tsx'];
const TEST_KEYWORDS = ['__tests__', 'tests', 'test', 'spec', 'cypress'];
const DOC_KEYWORDS = ['docs', 'documentation'];
const STYLE_KEYWORDS = ['styles', 'css', 'theme'];
const CONFIG_KEYWORDS = ['config', 'settings', 'env'];

const TYPE_TEMPLATES = {
  feat: (scope, noun) => `add ${noun || scope} capability`,
  fix: (scope, noun) => `fix ${noun || scope} flow`,
  refactor: (scope, noun) => `refine ${noun || scope} structure`,
  style: (scope, noun) => `tune ${noun || scope} styling`,
  docs: (scope, noun) => `update ${noun || scope} docs`,
  config: (scope, noun) => `update ${noun || scope} config`,
  test: (scope, noun) => `expand ${noun || scope} tests`
};

export function classifyFile(file, options) {
  const overrideType = getOverrideType(file.path, options.typeOverrides);
  const normalizedPath = file.path.replace(/\\/g, '/');
  const ext = path.posix.extname(normalizedPath).toLowerCase();

  const explicitType = overrideType || inferType(normalizedPath, ext, file);
  const scope = normalizeScope(normalizedPath, options.scopeDepth);
  const noun = deriveNoun(normalizedPath, file.change);
  const template = TYPE_TEMPLATES[explicitType] || (() => `update ${scope}`);
  const description = template(scope, noun);

  return {
    type: explicitType,
    scope,
    description,
    noun
  };
}

function getOverrideType(filePath, overrides = []) {
  for (const rule of overrides) {
    if (rule.regex && rule.regex.test(filePath)) {
      return rule.type;
    }
  }
  return null;
}

function inferType(filePath, ext, fileMeta) {
  if (isDocs(filePath, ext)) {
    return 'docs';
  }

  if (isStyle(filePath, ext)) {
    return 'style';
  }

  if (isConfig(filePath, ext)) {
    return 'config';
  }

  if (isTest(filePath, ext)) {
    return 'test';
  }

  if (fileMeta.change === 'deleted' || fileMeta.change === 'renamed') {
    return 'refactor';
  }

  if (fileMeta.change === 'new' || fileMeta.change === 'untracked') {
    return 'feat';
  }

  return 'fix';
}

function normalizeScope(filePath, depth = 1) {
  const sanitized = filePath.replace(/\\/g, '/');
  const segments = sanitized.split('/').filter(Boolean);

  if (!segments.length) {
    return 'root';
  }

  const relevantSegments = dropSourceFolder(segments);
  const sliceDepth = Math.min(depth, relevantSegments.length);
  const selected = relevantSegments.slice(0, sliceDepth);

  return selected.join('-').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() || 'root';
}

function dropSourceFolder(segments) {
  if (segments[0] === 'src' && segments.length > 1) {
    return segments.slice(1);
  }
  return segments;
}

function deriveNoun(filePath, change) {
  const ext = path.posix.extname(filePath).toLowerCase();
  const base = path.posix.basename(filePath).replace(ext, '');

  if (change === 'test' || isTest(filePath, ext)) {
    return `${base} tests`;
  }

  return base;
}

function isDocs(filePath, ext) {
  return DOC_EXTENSIONS.includes(ext) || DOC_KEYWORDS.some((keyword) => filePath.includes(`/${keyword}/`));
}

function isStyle(filePath, ext) {
  if (STYLE_EXTENSIONS.includes(ext)) {
    return true;
  }
  if (filePath.endsWith('.module.css')) {
    return true;
  }
  return STYLE_KEYWORDS.some((keyword) => filePath.includes(`/${keyword}/`));
}

function isConfig(filePath, ext) {
  if (CONFIG_EXTENSIONS.includes(ext)) {
    return true;
  }

  const CONFIG_FILE_NAMES = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts', 'vite.config.js', '.eslintrc.js', '.eslintrc.cjs', 'babel.config.js'];
  const base = path.posix.basename(filePath);
  if (CONFIG_FILE_NAMES.includes(base)) {
    return true;
  }

  return CONFIG_KEYWORDS.some((keyword) => filePath.includes(keyword));
}

function isTest(filePath, ext) {
  if (TEST_EXTENSIONS.includes(ext)) {
    return true;
  }
  return TEST_KEYWORDS.some((keyword) => filePath.includes(keyword));
}
