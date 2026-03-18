import { classifyFile } from './fileClassifier.js';

export function planCommits(files, options) {
  const {
    scopeDepth = 1,
    typeOverrides = [],
    ignorePatterns = [],
    maxFilesPerCommit = Infinity
  } = options;

  const orderedFiles = files.filter((file) => !matchesIgnore(file.path, ignorePatterns));

  const groups = new Map();

  orderedFiles.forEach((file, index) => {
    const classification = classifyFile(file, { scopeDepth, typeOverrides });
    const key = `${classification.type}:${classification.scope}`;

    if (!groups.has(key)) {
      groups.set(key, {
        ...classification,
        files: [],
        firstIndex: index
      });
    }

    const group = groups.get(key);
    group.files.push({ ...file, classification });
  });

  const sortedGroups = [...groups.values()].sort((a, b) => a.firstIndex - b.firstIndex);

  const plan = [];
  let counter = 1;

  sortedGroups.forEach((group) => {
    const chunks = chunkFiles(group.files, maxFilesPerCommit);

    chunks.forEach((chunk, chunkIndex) => {
      const baseMessage = `${group.type}(${group.scope}): ${group.description}`;
      const message = chunks.length > 1 ? `${baseMessage} (${chunkIndex + 1}/${chunks.length})` : baseMessage;

      plan.push({
        id: counter++,
        type: group.type,
        scope: group.scope,
        description: group.description,
        message,
        files: chunk,
        manualOverride: false
      });
    });
  });

  return plan;
}

function matchesIgnore(filePath, patterns = []) {
  return patterns.some((regex) => regex.test(filePath));
}

function chunkFiles(files, maxFilesPerCommit) {
  if (!Number.isFinite(maxFilesPerCommit) || files.length <= maxFilesPerCommit) {
    return [files];
  }

  const chunks = [];

  for (let index = 0; index < files.length; index += maxFilesPerCommit) {
    chunks.push(files.slice(index, index + maxFilesPerCommit));
  }

  return chunks;
}
