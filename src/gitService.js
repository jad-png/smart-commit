import path from 'node:path';
import simpleGit from 'simple-git';

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

      try {
        const args = [];
        if (options.cached) {
          args.push('--cached');
        }
        args.push('--', ...files);
        return await git.diff(args);
      } catch (error) {
        console.warn(`Unable to collect diff for ${files.join(', ')}: ${error.message}`);
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
