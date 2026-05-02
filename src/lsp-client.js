import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { languageIdForFile } from "./registry.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_DIAGNOSTIC_TIMEOUT_MS = 8000;

const SEVERITY_NAMES = {
  1: "error",
  2: "warning",
  3: "information",
  4: "hint"
};

const SYMBOL_KIND_NAMES = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enumMember",
  23: "struct",
  24: "event",
  25: "operator",
  26: "typeParameter"
};

export class LspSession {
  constructor({ server, command, args = [], workspace }) {
    this.server = server;
    this.command = command;
    this.args = args;
    this.workspace = path.resolve(workspace);
    this.process = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = Buffer.alloc(0);
    this.stderr = "";
    this.diagnosticsByUri = new Map();
    this.lastDiagnosticAt = 0;
    this.openedUris = new Set();
  }

  async start() {
    this.process = spawn(this.command, this.args, {
      cwd: this.workspace,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.process.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8");
      if (this.stderr.length > 12000) {
        this.stderr = this.stderr.slice(-12000);
      }
    });
    this.process.on("exit", (code, signal) => {
      const error = new Error(
        `${this.server.id} exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`
      );
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 25);
      this.process.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async initialize() {
    const rootUri = pathToFileUri(this.workspace);
    const result = await this.sendRequest(
      "initialize",
      {
        processId: process.pid,
        clientInfo: {
          name: "lsp-for-codex",
          version: "0.1.0"
        },
        locale: "en",
        rootPath: this.workspace,
        rootUri,
        workspaceFolders: [
          {
            uri: rootUri,
            name: path.basename(this.workspace)
          }
        ],
        capabilities: clientCapabilities(),
        trace: "off"
      },
      DEFAULT_REQUEST_TIMEOUT_MS
    );
    this.sendNotification("initialized", {});
    return result;
  }

  async openDocument(filePath) {
    const absolutePath = path.resolve(this.workspace, filePath);
    const text = await fs.readFile(absolutePath, "utf8");
    const uri = pathToFileUri(absolutePath);
    if (this.openedUris.has(uri)) return uri;

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: languageIdForFile(absolutePath),
        version: 1,
        text
      }
    });
    this.openedUris.add(uri);
    return uri;
  }

  async waitForDiagnostics(uris, timeoutMs = DEFAULT_DIAGNOSTIC_TIMEOUT_MS) {
    const wanted = new Set(uris);
    const start = Date.now();

    await new Promise((resolve) => {
      const timer = setInterval(() => {
        const elapsed = Date.now() - start;
        const hasAll = [...wanted].every((uri) => this.diagnosticsByUri.has(uri));
        const quiet = this.lastDiagnosticAt > 0 && Date.now() - this.lastDiagnosticAt >= 500;

        if ((hasAll && quiet) || elapsed >= timeoutMs) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });

    return [...wanted].flatMap((uri) =>
      (this.diagnosticsByUri.get(uri) ?? []).map((diagnostic) =>
        normalizeDiagnostic(fileUriToPath(uri), diagnostic)
      )
    );
  }

  async documentSymbols(filePath, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const absolutePath = path.resolve(this.workspace, filePath);
    const uri = await this.openDocument(absolutePath);
    await delay(250);
    const symbols = await this.sendRequest(
      "textDocument/documentSymbol",
      {
        textDocument: { uri }
      },
      timeoutMs
    );
    return normalizeSymbols(symbols ?? []);
  }

  async shutdown() {
    if (!this.process || this.process.exitCode !== null) return;

    try {
      await this.sendRequest("shutdown", null, 1500);
    } catch {
      // Some servers exit or ignore shutdown while diagnostics are still settling.
    }

    try {
      this.sendNotification("exit", null);
    } catch {
      // The process may already be gone.
    }

    await new Promise((resolve) => {
      if (!this.process || this.process.exitCode !== null) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        this.process.kill();
        resolve();
      }, 750);
      this.process.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  sendRequest(method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const id = this.nextId++;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.sendMessage(message);
    });
  }

  sendNotification(method, params) {
    this.sendMessage({
      jsonrpc: "2.0",
      method,
      params
    });
  }

  sendResponse(id, result) {
    this.sendMessage({
      jsonrpc: "2.0",
      id,
      result
    });
  }

  sendMessage(message) {
    if (!this.process?.stdin?.writable) {
      throw new Error(`${this.server.id} stdin is not writable`);
    }
    this.process.stdin.write(encodeLspMessage(message));
  }

  handleStdout(chunk) {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

    while (true) {
      const parsed = readLspMessage(this.stdoutBuffer);
      if (!parsed) return;
      this.stdoutBuffer = parsed.rest;
      this.handleMessage(parsed.message);
    }
  }

  handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
      this.handleServerRequest(message);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${pending.method} failed: ${JSON.stringify(message.error)}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      const uri = message.params?.uri;
      if (!uri) return;
      this.diagnosticsByUri.set(uri, message.params?.diagnostics ?? []);
      this.lastDiagnosticAt = Date.now();
    }
  }

  handleServerRequest(message) {
    switch (message.method) {
      case "workspace/configuration": {
        const items = message.params?.items ?? [];
        this.sendResponse(
          message.id,
          items.map((item) => configurationForSection(item?.section))
        );
        break;
      }
      case "workspace/workspaceFolders": {
        this.sendResponse(message.id, [
          {
            uri: pathToFileUri(this.workspace),
            name: path.basename(this.workspace)
          }
        ]);
        break;
      }
      case "client/registerCapability":
      case "client/unregisterCapability":
      case "window/workDoneProgress/create": {
        this.sendResponse(message.id, null);
        break;
      }
      default: {
        this.sendResponse(message.id, null);
      }
    }
  }
}

export async function collectDiagnosticsWithServer({
  server,
  status,
  workspace,
  files,
  timeoutMs = DEFAULT_DIAGNOSTIC_TIMEOUT_MS
}) {
  if (!status.available) {
    return {
      serverId: server.id,
      displayName: server.displayName,
      available: false,
      skipped: true,
      reason: "server_command_unavailable",
      install: status.install,
      diagnostics: []
    };
  }

  const session = new LspSession({
    server,
    command: status.command,
    args: status.args,
    workspace
  });

  try {
    await session.start();
    await session.initialize();
    const uris = [];
    for (const file of files) {
      uris.push(await session.openDocument(file));
    }
    const diagnostics = await session.waitForDiagnostics(uris, timeoutMs);
    return {
      serverId: server.id,
      displayName: server.displayName,
      available: true,
      command: status.command,
      args: status.args,
      source: status.source,
      fileCount: files.length,
      diagnostics,
      stderr: trimStderr(session.stderr)
    };
  } catch (error) {
    return {
      serverId: server.id,
      displayName: server.displayName,
      available: true,
      command: status.command,
      args: status.args,
      source: status.source,
      fileCount: files.length,
      diagnostics: [],
      error: error.message,
      stderr: trimStderr(session.stderr)
    };
  } finally {
    await session.shutdown();
  }
}

export async function documentSymbolsWithServer({
  server,
  status,
  workspace,
  file,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
}) {
  if (!status.available) {
    return {
      serverId: server.id,
      displayName: server.displayName,
      available: false,
      skipped: true,
      reason: "server_command_unavailable",
      install: status.install,
      symbols: []
    };
  }

  const session = new LspSession({
    server,
    command: status.command,
    args: status.args,
    workspace
  });

  try {
    await session.start();
    await session.initialize();
    const symbols = await session.documentSymbols(file, timeoutMs);
    return {
      serverId: server.id,
      displayName: server.displayName,
      available: true,
      command: status.command,
      args: status.args,
      source: status.source,
      file,
      symbols,
      stderr: trimStderr(session.stderr)
    };
  } catch (error) {
    return {
      serverId: server.id,
      displayName: server.displayName,
      available: true,
      command: status.command,
      args: status.args,
      source: status.source,
      file,
      symbols: [],
      error: error.message,
      stderr: trimStderr(session.stderr)
    };
  } finally {
    await session.shutdown();
  }
}

export function pathToFileUri(filePath) {
  return pathToFileURL(path.resolve(filePath)).href;
}

export function fileUriToPath(uri) {
  if (!uri.startsWith("file://")) return uri;
  return fileURLToPath(uri);
}

export function encodeLspMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, body]);
}

export function readLspMessage(buffer) {
  const crlfHeaderEnd = buffer.indexOf("\r\n\r\n");
  const lfHeaderEnd = buffer.indexOf("\n\n");
  const headerEnd = crlfHeaderEnd >= 0 ? crlfHeaderEnd : lfHeaderEnd;
  if (headerEnd < 0) return null;

  const separatorLength = crlfHeaderEnd >= 0 ? 4 : 2;
  const header = buffer.slice(0, headerEnd).toString("ascii");
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    throw new Error("Missing LSP Content-Length header");
  }

  const contentLength = Number(match[1]);
  const bodyStart = headerEnd + separatorLength;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) return null;

  const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
  return {
    message: JSON.parse(body),
    rest: buffer.slice(bodyEnd)
  };
}

function clientCapabilities() {
  return {
    workspace: {
      applyEdit: false,
      configuration: true,
      workspaceFolders: true,
      didChangeConfiguration: {
        dynamicRegistration: false
      },
      symbol: {
        dynamicRegistration: false
      }
    },
    textDocument: {
      synchronization: {
        dynamicRegistration: false,
        willSave: false,
        willSaveWaitUntil: false,
        didSave: true
      },
      publishDiagnostics: {
        relatedInformation: true,
        versionSupport: false,
        codeDescriptionSupport: true,
        dataSupport: true
      },
      documentSymbol: {
        dynamicRegistration: false,
        hierarchicalDocumentSymbolSupport: true,
        labelSupport: true
      },
      definition: {
        dynamicRegistration: false,
        linkSupport: true
      },
      hover: {
        dynamicRegistration: false,
        contentFormat: ["markdown", "plaintext"]
      }
    },
    window: {
      workDoneProgress: true,
      showMessage: {
        messageActionItem: {
          additionalPropertiesSupport: true
        }
      }
    },
    general: {
      positionEncodings: ["utf-16"]
    }
  };
}

function configurationForSection(section) {
  if (section === "eslint") {
    return {
      validate: "on",
      packageManager: "npm",
      useESLintClass: false,
      run: "onType",
      workingDirectory: { mode: "auto" },
      problems: { shortenToSingleLine: false },
      codeActionOnSave: { enable: false, mode: "all" }
    };
  }

  if (section === "yaml") {
    return {
      validate: true,
      hover: true,
      completion: true,
      schemas: {}
    };
  }

  return null;
}

function normalizeDiagnostic(file, diagnostic) {
  return {
    file,
    severity: SEVERITY_NAMES[diagnostic.severity] ?? "unknown",
    code: diagnostic.code ?? null,
    source: diagnostic.source ?? null,
    message: diagnostic.message ?? "",
    range: normalizeRange(diagnostic.range),
    relatedInformation: (diagnostic.relatedInformation ?? []).map((entry) => ({
      file: entry.location?.uri ? fileUriToPath(entry.location.uri) : null,
      range: normalizeRange(entry.location?.range),
      message: entry.message
    }))
  };
}

function normalizeRange(range) {
  if (!range) return null;
  return {
    start: {
      line: (range.start?.line ?? 0) + 1,
      character: (range.start?.character ?? 0) + 1
    },
    end: {
      line: (range.end?.line ?? 0) + 1,
      character: (range.end?.character ?? 0) + 1
    }
  };
}

function normalizeSymbols(symbols) {
  return symbols.map((symbol) => {
    if (symbol.location) {
      return {
        name: symbol.name,
        kind: SYMBOL_KIND_NAMES[symbol.kind] ?? "unknown",
        detail: symbol.detail ?? null,
        file: fileUriToPath(symbol.location.uri),
        range: normalizeRange(symbol.location.range),
        selectionRange: normalizeRange(symbol.location.range),
        children: []
      };
    }

    return {
      name: symbol.name,
      kind: SYMBOL_KIND_NAMES[symbol.kind] ?? "unknown",
      detail: symbol.detail ?? null,
      range: normalizeRange(symbol.range),
      selectionRange: normalizeRange(symbol.selectionRange),
      children: normalizeSymbols(symbol.children ?? [])
    };
  });
}

function trimStderr(stderr) {
  const text = String(stderr ?? "").trim();
  if (text.length <= 4000) return text;
  return `${text.slice(0, 4000)}\n...[truncated]`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
