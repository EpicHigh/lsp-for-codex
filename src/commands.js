import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CACHE_DIR_NAME, getServerById } from "./registry.js";

const execFileAsync = promisify(execFile);

export function getCacheDir() {
  if (process.env.CODEX_LSP_CACHE) return path.resolve(process.env.CODEX_LSP_CACHE);
  return path.join(os.homedir(), ".cache", DEFAULT_CACHE_DIR_NAME);
}

export function getNpmPrefix(cacheDir = getCacheDir()) {
  return path.join(cacheDir, "npm");
}

export async function resolveServerCommand(server, options = {}) {
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const cacheDir = options.cacheDir ?? getCacheDir();
  const install = server.install;
  const binary = install?.bin ?? server.command.binary;
  const args = install?.args ?? server.command.args ?? [];
  const searchDirs = buildSearchDirs({ workspace, cacheDir });
  const resolved = await findExecutable(binary, searchDirs);

  return {
    serverId: server.id,
    displayName: server.displayName,
    available: Boolean(resolved),
    command: resolved?.path ?? binary,
    args,
    source: resolved?.source ?? null,
    install: install
      ? {
          supported: true,
          type: install.type,
          packages: install.packages,
          cachePrefix: getNpmPrefix(cacheDir)
        }
      : {
          supported: false,
          type: "manual",
          requirements: server.requirements ?? [`${server.command.binary} available on PATH`]
        }
  };
}

export async function installServers(options = {}) {
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const cacheDir = options.cacheDir ?? getCacheDir();
  const serverIds = options.serverIds ?? [];
  const allowDownloads = options.allowDownloads === true;
  const results = [];

  for (const serverId of serverIds) {
    const server = getServerById(serverId);
    if (!server) {
      results.push({
        serverId,
        installed: false,
        status: "unknown_server",
        message: `Unknown LSP server id: ${serverId}`
      });
      continue;
    }

    if (!server.install) {
      results.push({
        serverId: server.id,
        displayName: server.displayName,
        installed: false,
        status: "manual_requirement",
        requirements: server.requirements ?? [`${server.command.binary} available on PATH`]
      });
      continue;
    }

    if (!allowDownloads) {
      results.push({
        serverId: server.id,
        displayName: server.displayName,
        installed: false,
        status: "approval_required",
        packages: server.install.packages,
        cachePrefix: getNpmPrefix(cacheDir),
        message: "Pass allowDownloads: true after user approval to install these packages."
      });
      continue;
    }

    const npmStatus = await findExecutable("npm", buildPathSearchDirs());
    if (!npmStatus) {
      results.push({
        serverId: server.id,
        displayName: server.displayName,
        installed: false,
        status: "npm_missing",
        message: "npm is required for this auto-install strategy."
      });
      continue;
    }

    const prefix = getNpmPrefix(cacheDir);
    await ensureNpmCachePackage(prefix);

    try {
      const { stdout, stderr } = await execFileAsync(
        npmStatus.path,
        [
          "install",
          "--prefix",
          prefix,
          "--no-audit",
          "--fund=false",
          "--package-lock=true",
          ...server.install.packages
        ],
        {
          cwd: workspace,
          timeout: options.timeoutMs ?? 120000,
          maxBuffer: 1024 * 1024 * 8
        }
      );
      const resolved = await resolveServerCommand(server, { workspace, cacheDir });
      results.push({
        serverId: server.id,
        displayName: server.displayName,
        installed: resolved.available,
        status: resolved.available ? "installed" : "install_completed_but_command_missing",
        command: resolved.command,
        args: resolved.args,
        source: resolved.source,
        packages: server.install.packages,
        cachePrefix: prefix,
        stdout: trimOutput(stdout),
        stderr: trimOutput(stderr)
      });
    } catch (error) {
      results.push({
        serverId: server.id,
        displayName: server.displayName,
        installed: false,
        status: "install_failed",
        packages: server.install.packages,
        cachePrefix: prefix,
        message: error.message,
        stdout: trimOutput(error.stdout ?? ""),
        stderr: trimOutput(error.stderr ?? "")
      });
    }
  }

  return {
    workspace,
    cacheDir,
    results
  };
}

export async function findExecutable(binary, searchDirs = []) {
  const candidates = executableCandidates(binary);

  if (binary.includes("/") || binary.includes(path.sep)) {
    for (const candidate of candidates) {
      const fullPath = path.resolve(candidate);
      if (await isExecutable(fullPath)) return { path: fullPath, source: "explicit" };
    }
    return null;
  }

  for (const directory of searchDirs) {
    for (const candidate of candidates) {
      const fullPath = path.join(directory.path, candidate);
      if (await isExecutable(fullPath)) {
        return { path: fullPath, source: directory.source };
      }
    }
  }

  return null;
}

function buildSearchDirs({ workspace, cacheDir }) {
  return [
    { path: path.join(workspace, "node_modules", ".bin"), source: "workspace" },
    { path: path.join(getNpmPrefix(cacheDir), "node_modules", ".bin"), source: "cache" },
    ...buildPathSearchDirs()
  ];
}

function buildPathSearchDirs() {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => ({ path: directory, source: "path" }));
}

function executableCandidates(binary) {
  if (process.platform === "win32" && !path.extname(binary)) {
    return [binary, `${binary}.cmd`, `${binary}.exe`, `${binary}.bat`];
  }
  return [binary];
}

async function isExecutable(filePath) {
  try {
    await fs.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureNpmCachePackage(prefix) {
  await fs.mkdir(prefix, { recursive: true });
  const packageJson = path.join(prefix, "package.json");
  try {
    await fs.access(packageJson);
  } catch {
    await fs.writeFile(
      packageJson,
      `${JSON.stringify(
        {
          name: "lsp-for-codex-cache",
          private: true,
          description: "Locally installed language servers for the lsp-for-codex plugin"
        },
        null,
        2
      )}\n`
    );
  }
}

function trimOutput(value) {
  const text = String(value ?? "").trim();
  if (text.length <= 4000) return text;
  return `${text.slice(0, 4000)}\n...[truncated]`;
}
