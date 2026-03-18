import { spawn } from 'node:child_process';

export async function maybeGenerateAiMessage(command, diff, fallback) {
  if (!command) {
    return fallback;
  }

  if (!diff || !diff.trim()) {
    return fallback;
  }

  return new Promise((resolve) => {
    const child = spawn(command, { shell: true });
    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0 && output.trim()) {
        resolve(output.trim().split('\n')[0]);
        return;
      }

      if (errorOutput) {
        console.warn(`AI helper stderr: ${errorOutput.trim()}`);
      }

      resolve(fallback);
    });

    child.on('error', () => resolve(fallback));

    child.stdin.write(diff);
    child.stdin.end();
  });
}
