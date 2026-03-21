import assert from 'node:assert/strict';
import { beforeEach, afterEach, describe, it } from 'node:test';
import { createLlmService } from '../src/llmService.js';

const BASE_META = {
  plannedType: 'feat',
  plannedScope: 'cli',
  files: [{ path: 'src/index.js', change: 'modified' }],
  description: 'add cli capability',
  message: 'feat(cli): add cli capability'
};

const SAMPLE_DIFF = 'diff --git a/src/index.js b/src/index.js\n@@ -1 +1 @@\n-console.log(1)\n+console.log(2)';

describe('AI commit subject generation', () => {
  let originalFetch;
  let originalWarn;
  let fetchQueue;
  let prompts;
  let warnings;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWarn = console.warn;
    fetchQueue = [];
    prompts = [];
    warnings = [];
    globalThis.fetch = createFetchMock(fetchQueue, prompts);
    console.warn = (message) => warnings.push(message);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });

  it('cleans markdown wrappers and returns the first valid commit line', async () => {
    enqueueResponse('Output: `feat(cli): add guard rails.`');
    const llm = createLlmService({ enabled: true, provider: 'ollama', model: 'phi3' });
    const result = await llm.generateCommitMessage(SAMPLE_DIFF, BASE_META);

    assert.equal(result, 'feat(cli): add guard rails');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /\[Context]/);
    assert.match(prompts[0], /Type: feat/);
    assert.match(prompts[0], /Scope: cli/);
    assert.match(prompts[0], /Files:/);
    assert.match(prompts[0], /\[Diff]/);
  });

  it('retries once with a correction prompt if the first response is invalid', async () => {
    enqueueResponse('some invalid explanation');
    enqueueResponse('fix(cli): stabilize flow');
    const llm = createLlmService({ enabled: true, provider: 'ollama', model: 'phi3' });
    const result = await llm.generateCommitMessage(SAMPLE_DIFF, BASE_META);

    assert.equal(result, 'fix(cli): stabilize flow');
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /Correction:/);
  });

  it('truncates long responses and logs a warning', async () => {
    const longSubject = `feat(cli): ${'a'.repeat(80)}`;
    enqueueResponse(longSubject);
    const llm = createLlmService({ enabled: true, provider: 'ollama', model: 'phi3' });
    const result = await llm.generateCommitMessage(SAMPLE_DIFF, BASE_META);

    assert.equal(result.length, 72);
    assert.ok(warnings.some((msg) => msg.includes('subject exceeded')));
  });

  it('throws when both responses are invalid', async () => {
    enqueueResponse('first invalid');
    enqueueResponse('still not conventional');
    const llm = createLlmService({ enabled: true, provider: 'ollama', model: 'phi3' });

    await assert.rejects(
      () => llm.generateCommitMessage(SAMPLE_DIFF, BASE_META),
      /invalid commit subject/i
    );
  });

  it('rejects code-like descriptions and accepts corrected human summary', async () => {
    enqueueResponse('fix(cli): return validateCommit(input)');
    enqueueResponse('fix(cli): improve commit subject validation');
    const llm = createLlmService({ enabled: true, provider: 'ollama', model: 'phi3' });

    const result = await llm.generateCommitMessage(SAMPLE_DIFF, BASE_META);

    assert.equal(result, 'fix(cli): improve commit subject validation');
    assert.equal(prompts.length, 2);
  });

  it('throws when the diff context is empty', async () => {
    const llm = createLlmService({ enabled: true, provider: 'ollama', model: 'phi3' });

    await assert.rejects(
      () => llm.generateCommitMessage('   ', BASE_META),
      /requires diff context/i
    );
  });

  function enqueueResponse(text) {
    fetchQueue.push({ text });
  }
});

function createFetchMock(queue, prompts) {
  return async (_url, init) => {
    if (!init || !init.body) {
      throw new Error('Missing request body');
    }
    const payload = JSON.parse(init.body);
    prompts.push(payload.prompt);

    if (!queue.length) {
      throw new Error('No mock LLM responses queued');
    }

    const next = queue.shift();
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { response: next.text };
      }
    };
  };
}
