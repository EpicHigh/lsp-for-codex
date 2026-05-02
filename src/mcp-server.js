#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  collectDiagnostics,
  documentSymbols,
  installLanguageServers,
  supportedServers,
  workspaceStatus
} from "./manager.js";
import { detectWorkspace } from "./detect.js";

const server = new McpServer({
  name: "lsp-for-codex",
  version: "0.1.0"
});

const workspaceOptions = {
  workspace: z
    .string()
    .optional()
    .describe("Absolute workspace path. If omitted, environment fallbacks or the server cwd are used."),
  files: z
    .array(z.string())
    .optional()
    .describe("Workspace-relative or absolute file paths to focus detection or diagnostics."),
  maxFiles: z
    .number()
    .int()
    .positive()
    .max(50000)
    .optional()
    .describe("Maximum files to scan before truncating workspace detection."),
  includeHidden: z
    .boolean()
    .optional()
    .describe("Whether to scan hidden directories beyond the built-in allowlist.")
};

const serverSelectionOptions = {
  serverIds: z
    .array(z.string())
    .optional()
    .describe("Specific server ids to target. Can be combined with languages."),
  languages: z
    .array(z.string())
    .optional()
    .describe("Languages to target, such as typescript, javascript, or go. Resolves to primary servers.")
};

server.registerTool(
  "lsp_supported_servers",
  {
    description: "List the built-in language server matrix, commands, extensions, markers, and install strategies.",
    inputSchema: z.object({})
  },
  async () => toolResult(supportedServers())
);

server.registerTool(
  "lsp_detect",
  {
    description: "Detect likely LSP servers for a workspace from project markers, package dependencies, and file extensions.",
    inputSchema: z.object(workspaceOptions)
  },
  async (args) => toolResult(await detectWorkspace(args))
);

server.registerTool(
  "lsp_status",
  {
    description: "Show detected language servers and whether their commands are available from the workspace, cache, or PATH.",
    inputSchema: z.object({
      ...workspaceOptions,
      ...serverSelectionOptions
    })
  },
  async (args) => toolResult(await workspaceStatus(args))
);

server.registerTool(
  "lsp_install",
  {
    description: "Install supported language servers into the local plugin cache after explicit user approval, or report manual requirements.",
    inputSchema: z.object({
      ...workspaceOptions,
      ...serverSelectionOptions,
      allowDownloads: z
        .boolean()
        .optional()
        .describe("Must be true after explicit user approval; otherwise this returns the install plan."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(600000)
        .optional()
        .describe("npm install timeout in milliseconds.")
    })
  },
  async (args) => toolResult(await installLanguageServers(args))
);

server.registerTool(
  "lsp_diagnostics",
  {
    description: "Start matching LSP servers, open target files, and return publishDiagnostics results.",
    inputSchema: z.object({
      ...workspaceOptions,
      ...serverSelectionOptions,
      installMissing: z
        .boolean()
        .optional()
        .describe("Attempt install for missing supported servers before diagnostics."),
      allowDownloads: z
        .boolean()
        .optional()
        .describe("Required with installMissing after explicit user approval."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(120000)
        .optional()
        .describe("Time to wait for diagnostics from each server."),
      installTimeoutMs: z
        .number()
        .int()
        .positive()
        .max(600000)
        .optional()
        .describe("npm install timeout if installMissing is enabled."),
      maxOpenFiles: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe("Maximum matching files to open per server.")
    })
  },
  async (args) => toolResult(await collectDiagnostics(args))
);

server.registerTool(
  "lsp_document_symbols",
  {
    description: "Return document symbols for one file using the best detected or requested language server.",
    inputSchema: z.object({
      workspace: z
        .string()
        .optional()
        .describe("Absolute workspace path. If omitted, environment fallbacks or the server cwd are used."),
      file: z.string().describe("Workspace-relative or absolute file path."),
      serverId: z
        .string()
        .optional()
        .describe("Specific server id to use. Defaults to the best detected server for the file."),
      languages: z
        .array(z.string())
        .optional()
        .describe("Languages to target, such as typescript, javascript, or go. Uses the first resolved primary server."),
      installMissing: z
        .boolean()
        .optional()
        .describe("Attempt install for a missing supported server before querying symbols."),
      allowDownloads: z
        .boolean()
        .optional()
        .describe("Required with installMissing after explicit user approval."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(120000)
        .optional()
        .describe("Time to wait for the documentSymbol response."),
      includeHidden: z.boolean().optional(),
      maxFiles: z.number().int().positive().max(50000).optional()
    })
  },
  async (args) => toolResult(await documentSymbols(args))
);

function toolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
