import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearCredentials,
  DEFAULT_REGISTRY_URL,
  runBind,
  runFeed,
  saveCredentials,
} from '@modexagents/core';

export interface ActionInputs {
  agentId: string;
  patterns: string[];
  bind: boolean;
  model?: string;
}

export interface ActionEnv {
  anthropicApiKey?: string;
  modexToken?: string;
  modexRegistryUrl?: string;
}

export interface ActionDeps {
  baseDir?: string;
  // If set, the temp credentials directory used for `bind` is created here and
  // left in place (tests inspect it); otherwise a fresh tmpdir is made and
  // removed afterward. Either way the credential file itself is cleared.
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  // Anthropic client override for tests — forwarded to runFeed.
  client?: unknown;
  log?: (msg: string) => void;
}

export interface ActionResult {
  skillsMdSha256: string;
  added: number;
  updated: number;
  bound: boolean;
}

class ActionError extends Error {}

/**
 * Action body, free of @actions/core I/O so it can be unit-tested.
 *
 * Feeds every pattern into the agent, then — if `bind` is set — writes the
 * registry token to a 0600 credentials file in a temp dir, binds, and clears
 * the credential in a finally. The token never lands anywhere persistent and
 * is never logged.
 */
export async function runAction(
  inputs: ActionInputs,
  env: ActionEnv,
  deps: ActionDeps = {},
): Promise<ActionResult> {
  const log = deps.log ?? (() => {});

  if (!env.anthropicApiKey && deps.client === undefined) {
    throw new ActionError(
      'ANTHROPIC_API_KEY is not set. Pass it via the workflow `env:` block.',
    );
  }
  if (inputs.patterns.length === 0) {
    throw new ActionError('No `patterns` supplied — nothing to feed.');
  }

  log(`Feeding ${inputs.patterns.length} pattern(s) into agent ${inputs.agentId}…`);
  const feed = await runFeed(inputs.agentId, inputs.patterns, {
    apiKey: env.anthropicApiKey,
    model: inputs.model,
    baseDir: deps.baseDir,
    client: deps.client,
  });

  const added = feed.perSource.reduce((n, s) => n + s.added.length, 0);
  const updated = feed.perSource.reduce((n, s) => n + s.updated.length, 0);
  // perSource is non-empty: runFeed throws on zero resolved sources.
  const skillsMdSha256 = feed.perSource[feed.perSource.length - 1]!.skillsMdSha256;

  if (!inputs.bind) {
    return { skillsMdSha256, added, updated, bound: false };
  }

  if (!env.modexToken) {
    throw new ActionError(
      'bind is enabled but MODEX_TOKEN is not set. Pass it via the workflow `env:` block.',
    );
  }

  // Materialize the token as a credentials file core can read, in a temp dir
  // we own and tear down. saveCredentials writes it 0600 in a 0700 dir.
  const ownsConfigDir = deps.configDir === undefined;
  const configDir = deps.configDir ?? (await mkdtemp(join(tmpdir(), 'modex-action-cfg-')));
  try {
    await saveCredentials(
      {
        schema_version: 1,
        access_token: env.modexToken,
        registry_url: env.modexRegistryUrl ?? DEFAULT_REGISTRY_URL,
      },
      configDir,
    );
    log(`Binding agent ${inputs.agentId}…`);
    await runBind(inputs.agentId, {
      baseDir: deps.baseDir,
      configDir,
      fetch: deps.fetch,
    });
  } finally {
    await clearCredentials(configDir).catch(() => {});
    if (ownsConfigDir) {
      await rm(configDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { skillsMdSha256, added, updated, bound: true };
}
