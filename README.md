# Smart Commit CLI

A mini Node.js CLI that inspects git status, groups related files, and generates Conventional Commits with meaningful scopes and descriptions. Ideal for keeping commit history clean without manual staging and message crafting.

## Features

- Detects staged, unstaged, and untracked files with status context
- Classifies files into `feat`, `fix`, `refactor`, `style`, `docs`, `config`, and `test`
- Groups files by type + scope (derived from folders) with optional chunking (`--max-files-per-commit`)
- Generates Conventional Commit messages, optionally refined by a local Ollama model with graceful fallback
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

# preview AI-enhanced messages (falls back when Ollama is unavailable)
npx smart-commit --dry-run --ai

# force a specific model + temperature
npx smart-commit --ai --ai-model llama3 --ai-temperature 0.1

# point to a remote/local network Ollama host
npx smart-commit --ai --ai-endpoint http://ollama.local:11434

# disable AI even if enabled in config
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
    "model": "llama3",
    "endpoint": "http://localhost:11434",
    "temperature": 0.2
  }
}
```

Pass `--config ./path/to/file` to load a different config.

## Ollama Setup

1. [Install Ollama](https://ollama.com/download) for your OS and ensure it is running (defaults to `http://localhost:11434`).
2. Pull the model you want to use, for example `ollama pull llama3`.
3. (Optional) Adjust `ai.model`, `ai.endpoint`, or `ai.temperature` in `smartcommit.config.json`.
4. Run `npx smart-commit --ai` to force AI usage or rely on the config defaults.
5. Need the full walkthrough? See [docs/llm_prompt_guide.txt](docs/llm_prompt_guide.txt) for model recommendations, prompt templates, and advanced Ollama configuration.

If Ollama is unreachable, the CLI logs a warning and reverts to the rule-based commit message so your workflow never blocks.

## LLM Prompt Template

The CLI sends a concise instruction to Ollama along with the git diff and planner metadata:

```
You are an expert release engineer who writes precise Conventional Commit subjects.
Return exactly one line using the form type(scope): short description.
Use lowercase types (feat, fix, refactor, docs, style, config, test).
Keep it under 70 characters and prefer imperative verbs.

Planned type: <type>
Planned scope: <scope>
Rule-based suggestion: <existing message>

Changed files:
- path/file.ts (modified)
...

Git diff:
<full diff here>

Respond with the commit subject only.
```

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

## Example Workflow

1. Work as usual and leave files unstaged (or staged—configurable).
2. Run `npx smart-commit`.
3. Review the grouped commits in the interactive prompt.
4. Confirm to let the tool run `git add` + `git commit` for each group.

Happy committing!
