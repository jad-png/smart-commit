import path from 'node:path';
import simpleGit from 'simple-git';

const MAX_DIFF_LINES = 100;
const MAX_DIFF_BYTES = 4096;
const DIFF_EXCLUDED_FILES = ['package-lock.json', 'pnpm-lock.yaml'];

export function createGitService(cwd) {
  const git = simpleGit({ baseDir: cwd });

  return {
    ensureRepo: async () => {
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        throw new Error('The current directory is not a git repository.');
      }
    },
    getStatus: async () => {
      const status = await git.status();
      return {
        raw: status,
        files: normalizeStatus(cwd, status)
      };
    },
    stage: async (files) => {
      if (!files.length) {
        return;
      }
      await git.add(files);
    },
    commit: async (message) => {
      await git.commit(message);
    },
    diff: async (files, options = {}) => {
      if (!files.length) {
        return '';
      }

      const filteredTargets = filterDiffTargets(files);
      const excludedTargets = collectExcludedFiles(files);

      if (!filteredTargets.length) {
        return formatExcludedDiffSummary(excludedTargets);
      }

      try {
        const args = [];
        if (options.cached) {
          args.push('--cached');
        }
        args.push('--', ...filteredTargets);
        const rawDiff = await git.diff(args);
        const truncated = truncateDiff(rawDiff);
        if (truncated.trim()) {
          return truncated;
        }
        return formatExcludedDiffSummary(excludedTargets);
      } catch (error) {
        console.warn(`Unable to collect diff for ${files.join(', ')}: ${error.message}`);
        return '';
      }
    },
    diffSingle: async (filePath, options = {}) => {
      if (!filePath) {
        return '';
      }

      try {
        const args = [];
        if (options.cached) {
          args.push('--cached');
        }
        args.push('--', filePath);
        const rawDiff = await git.diff(args);
        return truncateChunk(rawDiff, {
          maxLines: options.maxLines ?? MAX_DIFF_LINES,
          maxBytes: options.maxBytes ?? MAX_DIFF_BYTES,
          appendMarker: options.appendMarker ?? false
        });
      } catch (error) {
        console.warn(`Unable to collect diff for ${filePath}: ${error.message}`);
        return '';
      }
    }
  };
}

function normalizeStatus(cwd, status) {
  const files = [];
  const seen = new Set();

  status.files.forEach((entry) => {
    const normalized = buildFileEntry(cwd, entry.path, entry.index, entry.working_dir, entry.from);
    files.push(normalized);
    seen.add(normalized.path);
  });

  status.not_added.forEach((filePath) => {
    if (seen.has(filePath)) {
      return;
    }
    const normalized = buildFileEntry(cwd, filePath, '?', '?');
    files.push(normalized);
    seen.add(normalized.path);
  });

  status.renamed.forEach((entry) => {
    if (seen.has(entry.to)) {
      return;
    }
    const normalized = buildFileEntry(cwd, entry.to, 'R', ' ', entry.from);
    files.push(normalized);
    seen.add(normalized.path);
  });

  return files;
}

function buildFileEntry(cwd, filePath, indexFlag = ' ', workTreeFlag = ' ', fromPath) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const absolutePath = path.resolve(cwd, normalizedPath);
  const change = deriveChange(indexFlag, workTreeFlag);
  const staged = isMeaningfulFlag(indexFlag);
  const hasUnstaged = isMeaningfulFlag(workTreeFlag);
  const partiallyStaged = staged && hasUnstaged;

  return {
    path: normalizedPath,
    absolutePath,
    from: fromPath ? fromPath.replace(/\\/g, '/') : null,
    change,
    staged,
    hasUnstaged,
    partiallyStaged,
    indexFlag,
    workTreeFlag,
    statusLabel: describeStatus(change, staged, hasUnstaged, partiallyStaged)
  };
}

function deriveChange(indexFlag = ' ', workTreeFlag = ' ') {
  const flags = [indexFlag, workTreeFlag];
  if (flags.includes('?')) {
    return 'untracked';
  }
  if (flags.includes('A')) {
    return 'new';
  }
  if (flags.includes('D')) {
    return 'deleted';
  }
  if (flags.includes('R') || flags.includes('C')) {
    return 'renamed';
  }
  if (flags.includes('M')) {
    return 'modified';
  }
  return 'modified';
}

function isMeaningfulFlag(flag) {
  return typeof flag === 'string' && flag !== ' ' && flag !== '?';
}

function describeStatus(change, staged, hasUnstaged, partiallyStaged) {
  if (change === 'untracked') {
    return 'untracked';
  }

  if (change === 'new' && staged && !hasUnstaged) {
    return 'staged';
  }

  if (partiallyStaged) {
    return 'partially staged';
  }

  if (staged && !hasUnstaged) {
    return 'staged';
  }

  if (!staged && hasUnstaged) {
    return 'unstaged';
  }

  return change;
}

function filterDiffTargets(files = []) {
  return files.filter((filePath) => !shouldExcludeFromDiff(filePath));
}

function collectExcludedFiles(files = []) {
  return files.filter((filePath) => shouldExcludeFromDiff(filePath));
}

function formatExcludedDiffSummary(excluded = []) {
  if (!excluded.length) {
    return '';
  }

  const lines = excluded.map((filePath) => `- ${filePath} (diff omitted)`).join('\n');
  return `Diff omitted for excluded files:\n${lines}`;
}

function shouldExcludeFromDiff(filePath = '') {
  const normalized = filePath.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();

  if (DIFF_EXCLUDED_FILES.some((fileName) => lower.endsWith(`/${fileName}`) || lower === fileName)) {
    return true;
  }

  return lower.endsWith('.map');
}

function truncateDiff(rawDiff) {
  if (!rawDiff) {
    return '';
  }

  const chunks = splitDiffByFile(rawDiff);
  if (!chunks.length) {
    return truncateChunk(rawDiff);
  }

  return chunks.map(truncateChunk).join('\n');
}

function splitDiffByFile(rawDiff) {
  const regex = /^diff --git [^\n]+\n(?:[\s\S]*?)(?=^diff --git |\Z)/gm;
  const chunks = [];
  let match;

  while ((match = regex.exec(rawDiff)) !== null) {
    chunks.push(match[0]);
  }

  return chunks;
}

function truncateChunk(chunk, options = {}) {
  const {
    maxLines = MAX_DIFF_LINES,
    maxBytes = MAX_DIFF_BYTES,
    appendMarker = true
  } = options;

  if (!chunk) {
    return '';
  }

  let truncated = chunk;
  let wasTruncated = false;

  const lines = chunk.split('\n');
  if (lines.length > maxLines) {
    truncated = lines.slice(0, maxLines).join('\n');
    wasTruncated = true;
  }

  if (Buffer.byteLength(truncated, 'utf8') > maxBytes) {
    truncated = truncateByBytes(truncated, maxBytes);
    wasTruncated = true;
  }

  if (wasTruncated && appendMarker) {
    return `${truncated}\n... [diff truncated]\n`;
  }

  return truncated;
}

function truncateByBytes(text, byteLimit) {
  let bytes = 0;
  let result = '';

  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + charBytes > byteLimit) {
      break;
    }
    result += char;
    bytes += charBytes;
  }

  return result;
}
