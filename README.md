# modex-github-action

A GitHub Action that feeds sources into a [`modex`](https://github.com/rickyjs1955/modex-cli)
agent's `SKILLS.md` and optionally binds the agent to the Modex registry.

It is a thin wrapper over [`@mojax/core`](https://www.npmjs.com/package/@mojax/core) —
all extraction, provenance, and registry logic lives there.

## Usage

```yaml
- uses: rickyjs1955/modex-github-action@v0
  with:
    agent-id: 01928c8e-1234-7abc-8def-0123456789ab
    patterns: |
      docs/handbook.md
      papers/*.pdf
      https://example.com/article
    bind: true
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    MODEX_TOKEN: ${{ secrets.MODEX_TOKEN }}
    # MODEX_REGISTRY_URL: optional, defaults to https://registry.modex.md
```

The agent's `.modex/<agent-id>/` directory must already exist in the checkout
(create it with `modex agents create` and commit it, or in an earlier step).

### Inputs

| Input | Required | Description |
|---|---|---|
| `agent-id` | yes | UUIDv7 of the target agent. |
| `patterns` | yes | Newline- or space-separated file paths, globs, or http(s) URLs. |
| `bind` | no | After feeding, bind the agent to the registry. Default `false`. |
| `model` | no | Anthropic model id (default: Claude Haiku 4.5). |

### Outputs

| Output | Description |
|---|---|
| `skills-md-sha256` | sha256 of `SKILLS.md` after the final source. |
| `added` | Total skills added across all sources. |
| `updated` | Total skills updated across all sources. |

### Secrets

- **`ANTHROPIC_API_KEY`** — required, used for extraction.
- **`MODEX_TOKEN`** — required only when `bind: true`. The action writes it to a
  `0600` credentials file in a temp directory, uses it for the bind, and clears
  it in a `finally`. It is never persisted and never logged (the action also
  calls `core.setSecret` on it).

The corpus never leaves the runner — only the Anthropic API call (extraction)
and, when binding, the `SKILLS.md` content + hashes go out.

## Local development

This is a **JavaScript action**: the runner executes the committed
`dist/index.js` directly, so `dist/` is checked in and CI fails if it is stale.
Rebuild with `npm run build` after any `src/` change.

The action depends on the **published** `@mojax/core`. Before that package is
on npm, install it from a local tarball built in the `modex-cli` repo:

```sh
# in modex-cli: pnpm --filter @mojax/core pack  → modex-core-<version>.tgz
npm install
npm install ../modex-core-0.3.1.tgz --no-save
npm run build && npm test
```

## License

MIT — see [LICENSE](./LICENSE).
