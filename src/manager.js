import path from "node:path";
import { resolveServerCommand, getCacheDir, installServers } from "./commands.js";
import { detectWorkspace, scanWorkspace, selectFilesForServer } from "./detect.js";
import {
  collectDiagnosticsWithServer,
  documentSymbolsWithServer
} from "./lsp-client.js";
import {
  SERVER_REGISTRY,
  getServerById,
  installSummary,
  serverIdsForLanguages,
  serverSupportsDocumentSymbols,
  serverSupportsFile
} from "./registry.js";

const DEFAULT_MAX_OPEN_FILES = 40;

export function supportedServers() {
  return {
    servers: SERVER_REGISTRY.map((server) => ({
      id: server.id,
      displayName: server.displayName,
      languageIds: server.languageIds,
      extensions: server.extensions,
      filenames: server.filenames ?? [],
      markers: server.markers ?? [],
      packageDeps: server.packageDeps ?? [],
      command: server.command,
      install: installSummary(server)
    })),
    languageTargets: languageTargets()
  };
}

export async function workspaceStatus(options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  const detection = await detectWorkspace({
    workspace,
    files: options.files,
    maxFiles: options.maxFiles,
    includeHidden: options.includeHidden
  });
  const requested = requestedServerSelection(options);
  const serverIds = requested.hasTargets
    ? requested.serverIds
    : detection.candidates.map((candidate) => candidate.id);
  const statuses = await Promise.all(
    serverIds.map(async (serverId) => {
      const server = getServerById(serverId);
      if (!server) {
        return {
          serverId,
          available: false,
          status: "unknown_server"
        };
      }

      const status = await resolveServerCommand(server, { workspace });
      const detectionCandidate = detection.candidates.find((candidate) => candidate.id === server.id);
      return {
        ...status,
        detected: Boolean(detectionCandidate),
        confidence: detectionCandidate?.confidence ?? null,
        reasons: detectionCandidate?.reasons ?? []
      };
    })
  );

  return {
    workspace,
    cacheDir: getCacheDir(),
    detection,
    servers: [...unknownLanguageStatuses(requested.unknownLanguages), ...statuses]
  };
}

export async function installLanguageServers(options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  const requested = await targetServerSelection({ ...options, workspace });
  const result = await installServers({
    workspace,
    serverIds: requested.serverIds,
    allowDownloads: options.allowDownloads === true,
    timeoutMs: options.timeoutMs
  });
  return {
    ...result,
    results: [...unknownLanguageInstallResults(requested.unknownLanguages), ...result.results]
  };
}

export async function collectDiagnostics(options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxOpenFiles = options.maxOpenFiles ?? DEFAULT_MAX_OPEN_FILES;
  const files = await targetFiles(workspace, options.files, options.maxFiles, options.includeHidden);
  const detection = await detectWorkspace({
    workspace,
    files,
    maxFiles: options.maxFiles,
    includeHidden: options.includeHidden
  });
  const requested = requestedServerSelection(options);
  let serverIds = requested.hasTargets
    ? requested.serverIds
    : detection.candidates.map((candidate) => candidate.id);

  if (!requested.hasTargets && !serverIds.length) {
    serverIds = SERVER_REGISTRY
      .filter((server) => files.some((file) => serverSupportsFile(server, file)))
      .map((server) => server.id);
  }

  if (options.installMissing === true) {
    const installServerIds = serverIds.filter((serverId) => {
      const server = getServerById(serverId);
      return server && files.some((file) => serverSupportsFile(server, file));
    });
    await installServers({
      workspace,
      serverIds: installServerIds,
      allowDownloads: options.allowDownloads === true,
      timeoutMs: options.installTimeoutMs
    });
  }

  const serverResults = [...unknownLanguageDiagnosticResults(requested.unknownLanguages)];
  for (const serverId of serverIds) {
    const server = getServerById(serverId);
    if (!server) {
      serverResults.push({
        serverId,
        available: false,
        skipped: true,
        reason: "unknown_server",
        diagnostics: []
      });
      continue;
    }

    const serverFiles = selectFilesForServer(server, files, maxOpenFiles);
    if (!serverFiles.length) {
      serverResults.push({
        serverId: server.id,
        displayName: server.displayName,
        skipped: true,
        reason: "no_matching_files",
        diagnostics: []
      });
      continue;
    }

    const status = await resolveServerCommand(server, { workspace });
    serverResults.push(
      await collectDiagnosticsWithServer({
        server,
        status,
        workspace,
        files: serverFiles,
        timeoutMs
      })
    );
  }

  return {
    workspace,
    cacheDir: getCacheDir(),
    files: files.map((file) => path.relative(workspace, file) || "."),
    detection,
    summary: summarizeDiagnostics(serverResults),
    servers: serverResults
  };
}

export async function documentSymbols(options = {}) {
  const workspace = resolveWorkspace(options.workspace);
  if (!options.file) {
    throw new Error("file is required for document symbols");
  }

  const file = path.isAbsolute(options.file)
    ? path.resolve(options.file)
    : path.resolve(workspace, options.file);
  const detection = await detectWorkspace({
    workspace,
    files: [file],
    maxFiles: options.maxFiles,
    includeHidden: options.includeHidden
  });
  const requested = requestedServerSelection(options);
  if (!options.serverId && requested.hasTargets && !requested.serverIds.length) {
    return {
      workspace,
      file: path.relative(workspace, file) || ".",
      available: false,
      skipped: true,
      reason: "unknown_language",
      language: requested.unknownLanguages[0],
      symbols: []
    };
  }

  const serverId = options.serverId ?? requested.serverIds[0] ?? chooseServerForFile(file, detection);
  const server = getServerById(serverId);
  if (!server) {
    return {
      workspace,
      file: path.relative(workspace, file) || ".",
      serverId,
      available: false,
      skipped: true,
      reason: requested.unknownLanguages.length ? "unknown_language" : "unknown_or_unsupported_server",
      language: requested.unknownLanguages[0],
      symbols: []
    };
  }

  if (!serverSupportsFile(server, file)) {
    return {
      workspace,
      file: path.relative(workspace, file) || ".",
      serverId: server.id,
      displayName: server.displayName,
      skipped: true,
      reason: "no_matching_files",
      symbols: []
    };
  }

  if (options.installMissing === true) {
    await installServers({
      workspace,
      serverIds: [server.id],
      allowDownloads: options.allowDownloads === true,
      timeoutMs: options.installTimeoutMs
    });
  }

  const status = await resolveServerCommand(server, { workspace });
  const result = await documentSymbolsWithServer({
    server,
    status,
    workspace,
    file,
    timeoutMs: options.timeoutMs ?? 10000
  });

  return {
    workspace,
    cacheDir: getCacheDir(),
    detection,
    ...result,
    file: path.relative(workspace, file) || "."
  };
}

async function targetServerSelection(options = {}) {
  const requested = requestedServerSelection(options);
  if (requested.hasTargets) return requested;

  const detection = await detectWorkspace({
    workspace: options.workspace,
    files: options.files,
    maxFiles: options.maxFiles,
    includeHidden: options.includeHidden
  });
  return {
    serverIds: detection.candidates.map((candidate) => candidate.id),
    unknownLanguages: [],
    hasTargets: false
  };
}

async function targetFiles(workspace, files, maxFiles, includeHidden = false) {
  if (files?.length) {
    return files.map((file) =>
      path.isAbsolute(file) ? path.resolve(file) : path.resolve(workspace, file)
    );
  }

  const scan = await scanWorkspace(workspace, {
    maxFiles: maxFiles ?? 5000,
    includeHidden
  });
  return scan.files;
}

function chooseServerForFile(file, detection) {
  const candidates = detection.candidates
    .map((entry) => getServerById(entry.id))
    .filter((server) => server && serverSupportsFile(server, file));
  const symbolCandidate = candidates.find(serverSupportsDocumentSymbols);
  if (symbolCandidate) return symbolCandidate.id;
  if (candidates.length) return candidates[0].id;

  const fallback = SERVER_REGISTRY.find(
    (server) => serverSupportsFile(server, file) && serverSupportsDocumentSymbols(server)
  );
  return fallback?.id ?? SERVER_REGISTRY.find((server) => serverSupportsFile(server, file))?.id;
}

function summarizeDiagnostics(serverResults) {
  const summary = {
    errors: 0,
    warnings: 0,
    information: 0,
    hints: 0,
    unknown: 0,
    total: 0
  };

  for (const result of serverResults) {
    for (const diagnostic of result.diagnostics ?? []) {
      summary.total += 1;
      if (diagnostic.severity === "error") summary.errors += 1;
      else if (diagnostic.severity === "warning") summary.warnings += 1;
      else if (diagnostic.severity === "information") summary.information += 1;
      else if (diagnostic.severity === "hint") summary.hints += 1;
      else summary.unknown += 1;
    }
  }

  return summary;
}

function normalizeServerIds(serverIds) {
  const values = Array.isArray(serverIds) ? serverIds : [serverIds];
  return [...new Set(values.flatMap((value) => String(value ?? "").split(",")))]
    .map((value) => value.trim())
    .filter(Boolean);
}

function requestedServerSelection(options = {}) {
  const explicitServerIds = normalizeServerIds(options.serverIds ?? []);
  const languages = normalizeList(options.languages ?? []);
  const languageSelection = serverIdsForLanguages(languages);
  const serverIds = [...explicitServerIds];

  for (const serverId of languageSelection.serverIds) {
    if (!serverIds.includes(serverId)) serverIds.push(serverId);
  }

  return {
    serverIds,
    unknownLanguages: languageSelection.unknownLanguages,
    hasTargets: explicitServerIds.length > 0 || languages.length > 0
  };
}

function normalizeList(values) {
  if (Array.isArray(values)) return values;
  if (values === undefined || values === null) return [];
  return [values];
}

function languageTargets() {
  const targets = {};
  for (const server of SERVER_REGISTRY) {
    for (const languageId of server.languageIds) {
      const selection = serverIdsForLanguages([languageId]);
      if (selection.serverIds[0] === server.id) {
        targets[languageId] = server.id;
      }
    }
  }
  return targets;
}

function unknownLanguageStatuses(languages) {
  return languages.map((language) => ({
    language,
    available: false,
    status: "unknown_language"
  }));
}

function unknownLanguageInstallResults(languages) {
  return languages.map((language) => ({
    language,
    installed: false,
    status: "unknown_language",
    message: `Unknown language: ${language}`
  }));
}

function unknownLanguageDiagnosticResults(languages) {
  return languages.map((language) => ({
    language,
    available: false,
    skipped: true,
    reason: "unknown_language",
    diagnostics: []
  }));
}

function resolveWorkspace(workspace) {
  const fallback =
    process.env.CODEX_WORKSPACE ??
    process.env.WORKSPACE_DIR ??
    process.env.INIT_CWD ??
    process.cwd();
  return path.resolve(workspace ?? fallback);
}
