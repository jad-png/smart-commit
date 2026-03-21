# Smart Commit CLI

A mini Node.js CLI that inspects git status, groups related files, and generates Conventional Commits with meaningful scopes and descriptions. Ideal for keeping commit history clean without manual staging and message crafting.

## Features

- Detects staged, unstaged, and untracked files with status context
- Classifies files into `feat`, `fix`, `refactor`, `style`, `docs`, `config`, and `test`
- Groups files by type + scope (derived from folders) with optional chunking (`--max-files-per-commit`)
- Generates Conventional Commit messages through a mandatory local Ollama model (AI-first) with strict Conventional Commit validation
- Truncates noisy diffs before prompting Phi-3 to keep tokens focused on the most relevant changes
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

# preview the AI-generated subject lines without committing
npx smart-commit --dry-run

# force a specific model + temperature
npx smart-commit --ai --ai-model phi3 --ai-temperature 0.1

# point to a remote/local network Ollama host
npx smart-commit --ai --ai-endpoint http://ollama.local:11434

# disable AI even if enabled in config (expert-only)
npx smart-commit --no-ai
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
    "enabled": true,
    "provider": "ollama",
    "model": "phi3",
    "endpoint": "http://localhost:11434",
    "temperature": 0.1
  }
}
```

Pass `--config ./path/to/file` to load a different config.

## Ollama Setup

1. [Install Ollama](https://ollama.com/download) for your OS and ensure it is running (defaults to `http://localhost:11434`).
2. Pull the recommended base model: `ollama pull phi3` (extra lightweight, widely compatible, great for short commits).
3. (Optional) Adjust `ai.model`, `ai.endpoint`, or `ai.temperature` in `smartcommit.config.json`.
4. Run `npx smart-commit` (AI is enabled by default) or `npx smart-commit --no-ai` if you must fall back manually.
5. Need the full walkthrough? See [docs/llm_prompt_guide.txt](docs/llm_prompt_guide.txt) for model recommendations, prompt templates, and advanced Ollama configuration.

If Ollama is unreachable, the CLI will abort so you can fix the local model before committing. This ensures every commit subject is LLM-vetted.

## LLM Prompt Template

The CLI sends a concise instruction to Ollama along with the git diff and planner metadata:

```
[Context]
Type: <planned type>
Scope: <planned scope>
Files:
- path/file.ts (modified)
...

[Diff]
<truncated diff per file, first 100 lines or 4KB>

Instruction: Write the commit subject line following the type(scope): description format. Use imperative mood. Respond ONLY with the line.
```

The AI response is cleaned (no backticks or trailing periods), validated against `/^(feat|fix|refactor|docs|style|config|test)\(.+\): .+/`, and truncated to 72 characters if necessary. Invalid responses trigger an automatic correction prompt before the CLI aborts.

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
  llmService.js         # pluggable AI/Ollama integration layer
```

## Development Notes

- Requires Node.js 18+
- Uses ESM imports (`"type": "module"`)
- Run `npm start` to print CLI help
- Run `npm test` to execute the AI commit path regression suite

## Example Workflow

1. Work as usual and leave files unstaged (or staged—configurable).
2. Run `npx smart-commit`.
3. Review the grouped commits in the interactive prompt.
4. Confirm to let the tool run `git add` + `git commit` for each group.

Happy committing!
