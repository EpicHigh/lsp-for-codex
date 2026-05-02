# LSP for Codex

LSP for Codex is a local Codex plugin. It gives Codex an MCP bridge for Language Server Protocol workflows:

- auto-detect likely language servers from workspace markers and file extensions
- explain install and requirement status
- install supported npm-distributed servers into a local cache after approval
- collect `publishDiagnostics` from language servers for edited files
- query `textDocument/documentSymbol` for refactors

The plugin does not patch Codex CLI internals. It exposes the requested LSP capabilities as local MCP tools that Codex can call during an edit loop.

## Setup

```bash
npm install
npm test
```

The plugin manifest lives at `.codex-plugin/plugin.json`, and the MCP server is declared in `.mcp.json`.

## Install In Codex

1. Clone this repository somewhere stable on your machine:

   ```bash
   git clone https://github.com/EpicHigh/lsp-for-codex.git
   cd lsp-for-codex
   npm install
   ```

2. Add the repository root as a local Codex plugin. The selected folder must be the folder that contains `.codex-plugin/plugin.json`.

3. Restart or reload Codex so it reads the plugin manifest and starts the MCP server declared in `.mcp.json`.

4. Confirm the plugin is available by asking Codex to use one of the LSP tools, or by running the CLI directly:

   ```bash
   node src/cli.js servers
   node src/cli.js status /path/to/workspace
   ```

The plugin runs locally with `node ./src/mcp-server.js`. Language server downloads are not automatic; Codex must pass `allowDownloads: true` after user approval before `lsp_install` or `--install-missing` installs supported npm-distributed servers into the local cache.

## CLI

The same implementation is available from the command line:

```bash
node src/cli.js detect /path/to/workspace
node src/cli.js status /path/to/workspace
node src/cli.js install /path/to/workspace --server typescript --yes
node src/cli.js install /path/to/workspace --language typescript --language javascript --language go --yes
node src/cli.js diagnostics /path/to/workspace --file src/index.ts --server typescript
node src/cli.js symbols /path/to/workspace --file src/index.ts --server typescript
```

Language selectors resolve to the primary code-intelligence server for each language and are deduplicated. For example, `--language typescript --language javascript --language go` targets `typescript` and `gopls`; `gopls` is reported as a manual requirement unless it is already on `PATH`.

## Cache

Auto-installed servers are placed under:

```text
~/.cache/lsp-for-codex/npm
```

Override with:

```bash
CODEX_LSP_CACHE=/custom/cache node src/cli.js install /repo --language typescript --yes
```

## Supported Scope

The registry includes the broad server matrix requested in the issue. The first implementation supports automatic npm installs for servers distributed through npm, including TypeScript, Bash, YAML, Pyright, Astro, Svelte, Vue, Prisma, PHP Intelephense, and ESLint via `vscode-langservers-extracted`. Native toolchain servers such as `gopls`, `rust-analyzer`, `deno lsp`, `clangd`, `sourcekit-lsp`, and `jdtls` are detected and used when their commands are already available.

Downloads are explicit: the MCP tool requires `allowDownloads: true`, and the skill instructs Codex to ask first.
