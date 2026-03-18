import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig } from './config.js';
import { createGitService } from './gitService.js';
import { planCommits } from './commitPlanner.js';
import { createLlmService } from './llmService.js';

const program = new Command();

program
  .name('smart-commit')
  .description('Analyze project changes, group files logically, and craft Conventional Commits automatically.')
  .option('-d, --dry-run', 'preview the commit plan without running git add/commit', false)
  .option('--no-interactive', 'skip interactive previews and confirmations')
  .option('--no-include-staged', 'ignore already staged entries when planning commits')
  .option('-c, --config <path>', 'path to a custom smart-commit config file')
  .option('--ai', 'force AI usage even if disabled in config')
  .option('--no-ai', 'disable AI enhancements regardless of config')
  .option('--ai-model <model>', 'LLM model name to use when AI is enabled')
  .option('--ai-temperature <value>', 'LLM temperature between 0 and 1', parseFloatOption)
  .option('--ai-endpoint <url>', 'Override the Ollama endpoint (default http://localhost:11434)')
  .option('--max-files-per-commit <count>', 'split commits once the file count is reached', parseInteger)
  .option('--scope-depth <depth>', 'how many path segments to use for the commit scope', parseInteger)
  .showHelpAfterError('(add --help for usage information)')
  .action(async (options) => {
    try {
      await run(options);
    } catch (error) {
      console.error(chalk.red(`\n✖ ${error.message}`));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

async function run(cliOptions) {
  const cwd = process.cwd();
  const config = await loadConfig(cliOptions.config, cwd);
  const options = mergeOptions(cliOptions, config);
  const git = createGitService(cwd);
  const llm = createLlmService(options.ai);

  await git.ensureRepo();
  const status = await git.getStatus();
  const candidateFiles = filterFiles(status.files, options.includeStaged);

  if (!candidateFiles.length) {
    console.log(chalk.yellow('No unstaged or staged changes detected based on the current filters.'));
    return;
  }

  const plan = planCommits(candidateFiles, {
    scopeDepth: options.scopeDepth,
    typeOverrides: options.typeOverrides,
    ignorePatterns: options.ignorePatterns,
    maxFilesPerCommit: options.maxFilesPerCommit
  });

  if (!plan.length) {
    console.log(chalk.yellow('Files were filtered out by ignore rules. Nothing to commit.'));
    return;
  }

  printStatusSummary(status.files);
  printPlan(plan);

  if (options.interactive) {
    await maybeEditMessages(plan);
    const proceed = await confirmExecution(plan);
    if (!proceed) {
      console.log(chalk.gray('Commit run aborted by user.'));
      return;
    }
  }

  await executePlan(plan, git, options, llm);
}

function mergeOptions(cliOptions, config) {
  const scopeDepth = Number.isFinite(cliOptions.scopeDepth) ? cliOptions.scopeDepth : config.scopeDepth;
  const maxFilesPerCommit = Number.isFinite(cliOptions.maxFilesPerCommit)
    ? cliOptions.maxFilesPerCommit
    : config.maxFilesPerCommit;
  const aiEnabled = cliOptions.noAi ? false : cliOptions.ai ? true : config.ai.enabled;
  const aiTemperature = Number.isFinite(cliOptions.aiTemperature) ? cliOptions.aiTemperature : config.ai.temperature;

  return {
    dryRun: Boolean(cliOptions.dryRun),
    interactive: cliOptions.interactive ?? config.interactive,
    includeStaged: cliOptions.includeStaged ?? config.includeStaged,
    scopeDepth,
    maxFilesPerCommit,
    typeOverrides: config.typeOverrides,
    ignorePatterns: config.ignorePatterns,
    ai: {
      enabled: aiEnabled,
      provider: config.ai.provider,
      model: cliOptions.aiModel || config.ai.model,
      endpoint: cliOptions.aiEndpoint || config.ai.endpoint,
      temperature: aiTemperature,
      command: config.ai.command
    }
  };
}

function filterFiles(files, includeStaged) {
  if (includeStaged) {
    return files;
  }
  return files.filter((file) => !file.staged || file.hasUnstaged || file.change === 'untracked');
}

function printStatusSummary(files) {
  const counts = files.reduce(
    (acc, file) => {
      acc[file.change] = (acc[file.change] || 0) + 1;
      return acc;
    },
    {}
  );

  const summary = Object.entries(counts)
    .map(([change, count]) => `${count} ${change}`)
    .join(', ');

  console.log(`\n${chalk.bold('Detected changes:')} ${summary || 'clean'}`);
}

function printPlan(plan) {
  console.log(`\n${chalk.bold('Planned commits:')}`);
  plan.forEach((commit) => {
    console.log(chalk.cyan(`\n#${commit.id} ${commit.message}`));
    commit.files.forEach((file) => {
      const stateLabel = chalk.gray(`[${file.change}${file.partiallyStaged ? '*': ''}]`);
      console.log(`  ${stateLabel} ${file.path}`);
    });
  });
}

async function maybeEditMessages(plan) {
  const { wantsEdit } = await inquirer.prompt({
    type: 'confirm',
    name: 'wantsEdit',
    message: 'Edit any commit messages?',
    default: false
  });

  if (!wantsEdit) {
    return;
  }

  for (const commit of plan) {
    const { nextMessage } = await inquirer.prompt({
      type: 'input',
      name: 'nextMessage',
      message: `(${commit.type}/${commit.scope}) message:`,
      default: commit.message
    });

    if (nextMessage && nextMessage.trim()) {
      commit.message = nextMessage.trim();
      commit.manualOverride = true;
    }
  }
}

async function confirmExecution(plan) {
  const { proceed } = await inquirer.prompt({
    type: 'confirm',
    name: 'proceed',
    message: `Create ${plan.length} commit${plan.length > 1 ? 's' : ''}?`,
    default: true
  });

  return proceed;
}

async function executePlan(plan, git, options, llm) {
  for (const commit of plan) {
    const filePaths = commit.files.map((file) => file.path);
    const summaryLabel = `${commit.type}(${commit.scope})`;

    if (!options.dryRun) {
      await git.stage(filePaths);
    }

    let message = commit.message;

    if (llm.isEnabled() && !commit.manualOverride) {
      const diffOptions = !options.dryRun ? { cached: true } : undefined;
      const diff = await git.diff(filePaths, diffOptions);
      message = await llm.generateCommitMessage(diff, commit, commit.message);
    }

    if (options.dryRun) {
      console.log(chalk.gray(`\n[DRY RUN] git add ${filePaths.join(' ')}`));
      console.log(chalk.gray(`[DRY RUN] git commit -m "${message}"`));
      continue;
    }

    await git.commit(message);
    console.log(chalk.green(`✔ ${summaryLabel} committed (${filePaths.length} file${filePaths.length > 1 ? 's' : ''})`));
  }
}

function parseInteger(value, previous) {
  if (value === undefined) {
    return previous;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('Numeric options must be positive integers.');
  }

  return parsed;
}

function parseFloatOption(value, previous) {
  if (value === undefined) {
    return previous;
  }

  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('Temperature must be a number between 0 and 1.');
  }

  return parsed;
}
