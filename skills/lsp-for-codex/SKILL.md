---
name: lsp-for-codex
description: Use when the user asks Codex to use Language Server Protocol signals, detect or install language servers, collect diagnostics, inspect workspace symbols, or reduce build/typecheck loops with project-aware feedback.
---

# LSP for Codex

Use this skill when LSP diagnostics or symbol intelligence can improve a code edit, refactor, or debugging pass.

## Workflow

1. Resolve the absolute workspace path from the current repo before calling MCP tools.
2. Call `lsp_detect` to identify candidate language servers and why they matched.
3. Call `lsp_status` before diagnostics so missing requirements are visible. Use `languages` when the user names languages instead of server ids.
4. Ask the user before downloads. Only call `lsp_install` or set `installMissing: true` with `allowDownloads: true` after explicit approval. Prefer `languages` for user-facing install requests like TypeScript, JavaScript, or Go; the plugin resolves them to primary servers and deduplicates overlaps.
5. Call `lsp_diagnostics` on the files you are editing, then use the diagnostics as one feedback signal alongside tests and type checks.
6. For refactors, call `lsp_document_symbols` on relevant files before changing symbol-heavy code.

## Safety

- Language servers run locally against the workspace path you pass.
- Downloads go into the plugin cache directory, defaulting to `~/.cache/lsp-for-codex`.
- Treat diagnostics as advisory. If a language server cannot start, continue with normal repo checks and explain the fallback.

## Useful MCP Tools

- `lsp_supported_servers`: Show the built-in server matrix.
- `lsp_detect`: Detect workspace languages, markers, and likely servers.
- `lsp_status`: Show detected servers, or status for requested `serverIds`/`languages`.
- `lsp_install`: Install requested `serverIds`/`languages`, or detected supported servers, into the local cache.
- `lsp_diagnostics`: Start matching or requested `serverIds`/`languages`, open files, and return diagnostics.
- `lsp_document_symbols`: Return document symbols for one file, optionally using a requested `serverId` or `languages`.
