import * as core from '@actions/core';

import { runAction, type ActionInputs, type ActionEnv } from './run.js';

function parsePatterns(raw: string[]): string[] {
  // `patterns` is documented as newline- OR space-separated; getMultilineInput
  // splits on newlines, so split each line on whitespace too.
  return raw.flatMap((line) => line.split(/\s+/)).filter((p) => p.length > 0);
}

async function main(): Promise<void> {
  const inputs: ActionInputs = {
    agentId: core.getInput('agent-id', { required: true }),
    patterns: parsePatterns(core.getMultilineInput('patterns')),
    bind: core.getBooleanInput('bind'),
    model: core.getInput('model') || undefined,
  };

  const env: ActionEnv = {
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
    modexToken: process.env['MODEX_TOKEN'],
    modexRegistryUrl: process.env['MODEX_REGISTRY_URL'],
  };

  // Mask secrets in the log even though GitHub already masks registered
  // secrets — defense in depth, and covers tokens passed by other means.
  if (env.anthropicApiKey) core.setSecret(env.anthropicApiKey);
  if (env.modexToken) core.setSecret(env.modexToken);

  try {
    const result = await runAction(inputs, env, { log: core.info });
    core.setOutput('skills-md-sha256', result.skillsMdSha256);
    core.setOutput('added', String(result.added));
    core.setOutput('updated', String(result.updated));
    core.info(
      `Done: ${result.added} added, ${result.updated} updated` +
        (result.bound ? ', bound to registry' : ''),
    );
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

void main();
