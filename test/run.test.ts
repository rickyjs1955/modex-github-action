import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createAgent, loadCredentials, readChain, verifyChain } from '@modex/core';

import { runAction, type ActionInputs, type ActionEnv } from '../src/run.js';

const FIXED_ID = '01928c8e-1234-7abc-8def-0123456789ab';
const REGISTRY = 'https://registry.example';

function fakeAnthropic(
  skillsByCall: Array<Array<{ slug: string; name: string; description: string; tags: string[] }>>,
) {
  let call = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        const skills = skillsByCall[call] ?? skillsByCall[skillsByCall.length - 1] ?? [];
        call++;
        return {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5-20251001',
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'tool_use', id: 't1', name: 'emit_skills', input: { skills } }],
        };
      }),
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bindFetch(): typeof globalThis.fetch {
  return vi.fn(async () =>
    jsonResponse(200, {
      skills_md_sha256: 'f'.repeat(64),
      bound_at: '2026-05-15T01:00:00.000Z',
    }),
  ) as unknown as typeof globalThis.fetch;
}

async function tempDirs() {
  return {
    baseDir: await mkdtemp(join(tmpdir(), 'modex-action-base-')),
    configDir: await mkdtemp(join(tmpdir(), 'modex-action-cfg-')),
  };
}

const ENV: ActionEnv = { anthropicApiKey: 'test-key' };

describe('runAction', () => {
  it('feeds sources and returns sha + counts (bind disabled)', async () => {
    const { baseDir } = await tempDirs();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-15T00:00:00.000Z', name: 'ci' });
    const corpus = join(baseDir, 'book.md');
    await writeFile(corpus, 'A corpus describing techniques.', 'utf8');

    const inputs: ActionInputs = {
      agentId: FIXED_ID,
      patterns: [corpus],
      bind: false,
    };
    const result = await runAction(inputs, ENV, {
      baseDir,
      client: fakeAnthropic([
        [{ slug: 'one', name: 'One', description: 'd', tags: ['x'] }],
      ]),
    });

    expect(result.bound).toBe(false);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skillsMdSha256).toMatch(/^[0-9a-f]{64}$/);

    const chain = await readChain(join(baseDir, '.modex', FIXED_ID, 'provenance.jsonl'));
    expect(chain).toHaveLength(2);
    verifyChain(chain);
  });

  it('feeds then binds, materializing and clearing the token credential', async () => {
    const { baseDir, configDir } = await tempDirs();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-15T00:00:00.000Z' });
    const corpus = join(baseDir, 'book.md');
    await writeFile(corpus, 'A corpus.', 'utf8');

    const inputs: ActionInputs = {
      agentId: FIXED_ID,
      patterns: [corpus],
      bind: true,
    };
    const result = await runAction(
      inputs,
      { anthropicApiKey: 'test-key', modexToken: 'tok_live', modexRegistryUrl: REGISTRY },
      {
        baseDir,
        configDir,
        client: fakeAnthropic([[{ slug: 'one', name: 'One', description: 'd', tags: ['x'] }]]),
        fetch: bindFetch(),
      },
    );

    expect(result.bound).toBe(true);

    // genesis + feed + bound
    const chain = await readChain(join(baseDir, '.modex', FIXED_ID, 'provenance.jsonl'));
    expect(chain.map((e) => e.kind)).toEqual(['agent_created', 'feed', 'bound']);
    verifyChain(chain);

    // The credential was cleared from the temp config dir afterward.
    expect(await loadCredentials(configDir)).toBeNull();
  });

  it('fails when ANTHROPIC_API_KEY is absent and no client is injected', async () => {
    const { baseDir } = await tempDirs();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-15T00:00:00.000Z' });
    await expect(
      runAction(
        { agentId: FIXED_ID, patterns: ['book.md'], bind: false },
        {},
        { baseDir },
      ),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('fails when bind is enabled but MODEX_TOKEN is absent', async () => {
    const { baseDir } = await tempDirs();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-15T00:00:00.000Z' });
    const corpus = join(baseDir, 'book.md');
    await writeFile(corpus, 'A corpus.', 'utf8');
    await expect(
      runAction(
        { agentId: FIXED_ID, patterns: [corpus], bind: true },
        { anthropicApiKey: 'test-key' },
        {
          baseDir,
          client: fakeAnthropic([[{ slug: 'one', name: 'One', description: 'd', tags: ['x'] }]]),
        },
      ),
    ).rejects.toThrow(/MODEX_TOKEN/);
  });
});
