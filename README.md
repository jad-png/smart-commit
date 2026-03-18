# Smart Commit CLI

A mini Node.js CLI that inspects git status, groups related files, and generates Conventional Commits with meaningful scopes and descriptions. Ideal for keeping commit history clean without manual staging and message crafting.

## Features

- Detects staged, unstaged, and untracked files with status context
- Classifies files into `feat`, `fix`, `refactor`, `style`, `docs`, `config`, and `test`
- Groups files by type + scope (derived from folders) with optional chunking (`--max-files-per-commit`)
- Generates Conventional Commit messages, with optional AI refinement using any shell-accessible LLM command
- Interactive preview (toggle with `--no-interactive`), plus dry-run mode for verification
- Config file support for overrides, ignore patterns, and defaults

## Install

```bash
cd /path/to/your/project
npm install
```

You can run the CLI with `npx smart-commit` or add it as a dev dependency inside another project and use it from `node_modules/.bin`.

## Usage

```bash
# basic run with interactive confirmation
npx smart-commit

# dry run preview
npx smart-commit --dry-run

# ignore already staged files when planning
npx smart-commit --no-include-staged

# customize scope depth and commit size
npx smart-commit --scope-depth 2 --max-files-per-commit 5

# feed git diff to an AI helper that emits a single-line subject
npx smart-commit --ai "openai api chats.create --model gpt-4o-mini"
```

### Example Session

```
$ npx smart-commit --dry-run
Detected changes: 3 modified, 2 untracked

Planned commits:
#1 feat(auth): add auth capability
  [modified] src/auth/login.ts
  [modified] src/auth/logout.ts
#2 docs(root): update readme docs
  [untracked] README.md

[DRY RUN] git add src/auth/login.ts src/auth/logout.ts
[DRY RUN] git commit -m "feat(auth): add auth capability"
[DRY RUN] git add README.md
[DRY RUN] git commit -m "docs(root): update readme docs"
```

## Configuration

Create `smartcommit.config.json` (or `.smartcommitrc` / `.smartcommitrc.json`) in the project root.

```json
{
  "interactive": true,
  "includeStaged": true,
  "scopeDepth": 2,
  "maxFilesPerCommit": 5,
  "ignorePatterns": ["^dist/"],
  "typeOverrides": [
    { "pattern": "src/ui/.*\\.(ts|tsx)$", "type": "style", "scope": "ui" }
  ],
  "ai": {
    "command": "bash scripts/commit-ai.sh"
  }
}
```

Pass `--config ./path/to/file` to load a different config.

## Project Structure

```
package.json
bin/
  smart-commit.js
src/
  index.js              # CLI entrypoint + orchestration
  config.js             # loads & validates config
  gitService.js         # wraps simple-git operations
  fileClassifier.js     # infers commit types/scopes
  commitPlanner.js      # groups files into commits
  ai.js                 # optional external AI helper
```

## Development Notes

- Requires Node.js 18+
- Uses ESM imports (`"type": "module"`)
- Run `npm start` to print CLI help

## Example Workflow

1. Work as usual and leave files unstaged (or staged—configurable).
2. Run `npx smart-commit`.
3. Review the grouped commits in the interactive prompt.
4. Confirm to let the tool run `git add` + `git commit` for each group.

Happy committing!
