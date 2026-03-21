import path from 'node:path';

const STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.styl', '.pcss'];
const DOC_EXTENSIONS = ['.md', '.mdx', '.rst', '.adoc', '.txt'];
const CONFIG_EXTENSIONS = ['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.env', '.conf', '.config', '.cfg'];
const TEST_EXTENSIONS = ['.test.js', '.test.ts', '.spec.js', '.spec.ts', '.test.jsx', '.test.tsx', '.spec.jsx', '.spec.tsx'];
const TEST_KEYWORDS = ['__tests__', 'tests', 'test', 'spec', 'cypress'];
const DOC_KEYWORDS = ['docs', 'documentation'];
const STYLE_KEYWORDS = ['styles', 'css', 'theme'];
const CONFIG_KEYWORDS = ['config', 'settings', 'env'];
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'these', 'those', 'true', 'false',
  'null', 'undefined', 'return', 'const', 'let', 'var', 'function', 'class', 'import', 'export',
  'default', 'async', 'await', 'public', 'private', 'protected', 'static', 'new', 'extends',
  'value', 'data', 'item', 'items', 'file', 'files', 'line', 'lines', 'type', 'scope', 'model'
]);

const TYPE_TEMPLATES = {
  feat: (scope, topic) => `add ${topic || scope} capability`,
  fix: (scope, topic) => `fix ${topic || scope} flow`,
  refactor: (scope, topic) => `refine ${topic || scope} structure`,
  style: (scope, topic) => `tune ${topic || scope} styling`,
  docs: (scope, topic) => `update ${topic || scope} docs`,
  config: (scope, topic) => `update ${topic || scope} config`,
  test: (scope, topic) => `expand ${topic || scope} tests`
};

export async function classifyFile(file, options) {
  const overrideType = getOverrideType(file.path, options.typeOverrides);
  const normalizedPath = file.path.replace(/\\/g, '/');
  const ext = path.posix.extname(normalizedPath).toLowerCase();
  const diffPreview = file.diffPreview || '';
  const contentTopic = deriveContentTopic(diffPreview);

  const explicitType = overrideType || inferType(normalizedPath, ext, file, diffPreview);
  const scope = normalizeScope(normalizedPath, options.scopeDepth);
  const template = TYPE_TEMPLATES[explicitType] || (() => `update ${scope}`);
  const description = template(scope, contentTopic);

  return {
    type: explicitType,
    scope,
    description,
    noun: contentTopic
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

function inferType(filePath, ext, fileMeta, diffPreview) {
  if (isDocs(filePath, ext) || looksLikeDocs(diffPreview)) {
    return 'docs';
  }

  if (isStyle(filePath, ext) || looksLikeStyle(diffPreview)) {
    return 'style';
  }

  if (isConfig(filePath, ext) || looksLikeConfig(diffPreview)) {
    return 'config';
  }

  if (isTest(filePath, ext) || looksLikeTest(diffPreview)) {
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

function deriveContentTopic(diff) {
  if (!diff) {
    return null;
  }

  const addedLines = [];
  const removedLines = [];
  const changedLines = diff
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length && !isDiffMetadata(line));

  changedLines.forEach((line) => {
    if (line.startsWith('+')) {
      const value = line.slice(1).trim();
      if (value && !isIgnorableLine(value)) {
        addedLines.push(value);
      }
      return;
    }

    if (line.startsWith('-')) {
      const value = line.slice(1).trim();
      if (value && !isIgnorableLine(value)) {
        removedLines.push(value);
      }
    }
  });

  const intent = inferIntent(addedLines, removedLines);
  const keywords = extractTopKeywords([...addedLines, ...removedLines]);

  if (!keywords.length) {
    return intent || null;
  }

  const topic = keywords.slice(0, 3).join(' and ');
  return intent ? `${intent} ${topic}` : topic;
}

function isIgnorableLine(line) {
  const COMMENT_PREFIXES = ['//', '/*', '*', '#', '--', '<!--'];
  return COMMENT_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function truncateWords(text, maxWords) {
  const words = text.split(' ');
  if (words.length <= maxWords) {
    return text;
  }
  return words.slice(0, maxWords).join(' ');
}

function looksLikeDocs(diff = '') {
  return /(#[#\s]|\+\s*#|\-\s*#)/.test(diff);
}

function looksLikeStyle(diff = '') {
  return /\b(color|font|display|flex|grid|margin|padding)\b/i.test(diff);
}

function looksLikeConfig(diff = '') {
  return /"?(name|version|config|setting|env)"?\s*[:=]/i.test(diff);
}

function looksLikeTest(diff = '') {
  return /(describe\(|it\(|test\(|expect\()/i.test(diff);
}

function inferIntent(addedLines, removedLines) {
  const addedCount = addedLines.length;
  const removedCount = removedLines.length;

  if (addedCount > 0 && removedCount === 0) {
    return 'new';
  }

  if (removedCount > 0 && addedCount === 0) {
    return 'legacy';
  }

  if (addedCount > 0 && removedCount > 0) {
    return 'update';
  }

  return null;
}

function extractTopKeywords(lines = []) {
  const weights = new Map();

  lines.forEach((line) => {
    const normalized = line
      .replace(/['"`]/g, ' ')
      .replace(/[^a-zA-Z0-9_\-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      return;
    }

    splitIdentifiers(normalized).forEach((word) => {
      const lower = word.toLowerCase();
      if (!isKeywordCandidate(lower)) {
        return;
      }
      weights.set(lower, (weights.get(lower) || 0) + 1);
    });
  });

  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

function splitIdentifiers(text) {
  return text
    .split(' ')
    .flatMap((token) => token.split(/[_-]/g))
    .flatMap((token) => token.split(/(?=[A-Z])/g))
    .map((token) => token.trim())
    .filter(Boolean);
}

function isKeywordCandidate(word) {
  if (!word || word.length < 3 || word.length > 20) {
    return false;
  }

  if (/^\d+$/.test(word)) {
    return false;
  }

  return !STOPWORDS.has(word);
}

function isDiffMetadata(line) {
  const META_PREFIXES = ['diff --git', 'index ', '---', '+++', '@@'];
  return META_PREFIXES.some((prefix) => line.startsWith(prefix));
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
