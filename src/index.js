import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig } from './config.js';
import { createGitService } from './gitService.js';
import { planCommits } from './commitPlanner.js';
import { maybeGenerateAiMessage } from './ai.js';

const program = new Command();

program
  .name('smart-commit')
  .description('Analyze project changes, group files logically, and craft Conventional Commits automatically.')
  .option('-d, --dry-run', 'preview the commit plan without running git add/commit', false)
  .option('--no-interactive', 'skip interactive previews and confirmations')
  .option('--no-include-staged', 'ignore already staged entries when planning commits')
  .option('-c, --config <path>', 'path to a custom smart-commit config file')
  .option('--ai <command>', 'shell command that accepts a diff via stdin and outputs a commit subject line')
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

  await executePlan(plan, git, options);
}

function mergeOptions(cliOptions, config) {
  const scopeDepth = Number.isFinite(cliOptions.scopeDepth) ? cliOptions.scopeDepth : config.scopeDepth;
  const maxFilesPerCommit = Number.isFinite(cliOptions.maxFilesPerCommit)
    ? cliOptions.maxFilesPerCommit
    : config.maxFilesPerCommit;

  return {
    dryRun: Boolean(cliOptions.dryRun),
    interactive: cliOptions.interactive ?? config.interactive,
    includeStaged: cliOptions.includeStaged ?? config.includeStaged,
    scopeDepth,
    maxFilesPerCommit,
    typeOverrides: config.typeOverrides,
    ignorePatterns: config.ignorePatterns,
    aiCommand: cliOptions.ai || (config.ai ? config.ai.command : null)
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

async function executePlan(plan, git, options) {
  for (const commit of plan) {
    const filePaths = commit.files.map((file) => file.path);
    const summaryLabel = `${commit.type}(${commit.scope})`;

    if (options.dryRun) {
      console.log(chalk.gray(`\n[DRY RUN] git add ${filePaths.join(' ')}`));
      console.log(chalk.gray(`[DRY RUN] git commit -m "${commit.message}"`));
      continue;
    }

    await git.stage(filePaths);
    let message = commit.message;

    if (options.aiCommand) {
      const diff = await git.diff(filePaths);
      message = await maybeGenerateAiMessage(options.aiCommand, diff, commit.message);
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
