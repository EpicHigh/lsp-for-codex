#!/usr/bin/env node
import { detectWorkspace } from "./detect.js";
import {
  collectDiagnostics,
  documentSymbols,
  installLanguageServers,
  supportedServers,
  workspaceStatus
} from "./manager.js";

const command = process.argv[2] ?? "help";

try {
  const { workspace, options } = parseArgs(process.argv.slice(3));
  let result;

  switch (command) {
    case "servers":
    case "supported":
      result = supportedServers();
      break;
    case "detect":
      result = await detectWorkspace({ workspace, ...options });
      break;
    case "status":
      result = await workspaceStatus({ workspace, ...options });
      break;
    case "install":
      result = await installLanguageServers({
        workspace,
        ...options,
        allowDownloads: options.allowDownloads === true
      });
      break;
    case "diagnostics":
      result = await collectDiagnostics({ workspace, ...options });
      break;
    case "symbols":
    case "document-symbols":
      result = await documentSymbols({ workspace, ...options });
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      process.exit(0);
    default:
      throw new Error(`Unknown command: ${command}`);
  }

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function parseArgs(argv) {
  const positionals = [];
  const options = {
    files: [],
    languages: [],
    serverIds: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--workspace":
        options.workspace = readValue(argv, ++index, arg);
        break;
      case "--file":
      case "-f":
        options.files.push(readValue(argv, ++index, arg));
        break;
      case "--server":
      case "-s":
        options.serverIds.push(readValue(argv, ++index, arg));
        break;
      case "--language":
      case "--lang":
      case "-l":
        options.languages.push(readValue(argv, ++index, arg));
        break;
      case "--yes":
      case "--allow-downloads":
        options.allowDownloads = true;
        break;
      case "--install-missing":
        options.installMissing = true;
        break;
      case "--include-hidden":
        options.includeHidden = true;
        break;
      case "--timeout":
        options.timeoutMs = Number(readValue(argv, ++index, arg));
        break;
      case "--install-timeout":
        options.installTimeoutMs = Number(readValue(argv, ++index, arg));
        break;
      case "--max-files":
        options.maxFiles = Number(readValue(argv, ++index, arg));
        break;
      case "--max-open-files":
        options.maxOpenFiles = Number(readValue(argv, ++index, arg));
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
        positionals.push(arg);
    }
  }

  const symbolCommand = command === "symbols" || command === "document-symbols";
  if (symbolCommand) {
    const fileFromFlag = options.files[0];
    if (fileFromFlag) {
      options.file = fileFromFlag;
    } else {
      options.file = positionals.length >= 2 ? positionals[1] : positionals[0];
    }
    delete options.files;
    const serverIds = normalizeServerIds(options.serverIds);
    if (serverIds.length) {
      options.serverId = serverIds[0];
    }
    delete options.serverIds;
    if (!options.languages.length) delete options.languages;

    const workspace =
      options.workspace ??
      (fileFromFlag || positionals.length >= 2 ? positionals[0] : undefined) ??
      process.cwd();

    return { workspace, options };
  }

  if (!options.files.length) delete options.files;
  if (!options.languages.length) delete options.languages;
  if (!options.serverIds.length) delete options.serverIds;

  const workspace =
    options.workspace ??
    positionals[0] ??
    process.cwd();

  return { workspace, options };
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function normalizeServerIds(serverIds) {
  const values = Array.isArray(serverIds) ? serverIds : [serverIds];
  return [...new Set(values.flatMap((value) => String(value ?? "").split(",")))]
    .map((value) => value.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`LSP for Codex

Usage:
  node src/cli.js servers
  node src/cli.js detect [workspace] [--file path]
  node src/cli.js status [workspace] [--server id]
  node src/cli.js install [workspace] --server id --yes
  node src/cli.js install [workspace] --language typescript --language go --yes
  node src/cli.js diagnostics [workspace] --file path [--server id]
  node src/cli.js symbols [workspace] --file path [--server id]

Options:
  --workspace path       Explicit workspace path
  --file, -f path        File to inspect; repeatable
  --server, -s id        Server id; repeatable or comma-separated
  --language, -l name    Language to target; repeatable or comma-separated
  --yes                  Allow npm downloads for install
  --install-missing      Install before diagnostics or symbols
  --timeout ms           LSP request or diagnostic timeout
  --max-files n          Maximum files to scan
  --max-open-files n     Maximum files opened per server
  --include-hidden       Include hidden directories beyond the allowlist
`);
}
