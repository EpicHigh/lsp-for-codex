import fs from "node:fs/promises";
import path from "node:path";
import {
  IGNORED_DIRECTORIES,
  SERVER_REGISTRY,
  extensionForFile,
  installSummary,
  serverSupportsFile
} from "./registry.js";

const DEFAULT_MAX_FILES = 5000;
const HIDDEN_DIRECTORY_ALLOWLIST = new Set([".github"]);

export async function detectWorkspace(options = {}) {
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const explicitFiles = normalizeInputFiles(workspace, options.files ?? []);
  const scan = await scanWorkspace(workspace, {
    maxFiles,
    includeHidden: options.includeHidden ?? false
  });

  const allFiles = uniqueStrings([...scan.files, ...explicitFiles]);
  const relativeFiles = allFiles.map((file) => safeRelative(workspace, file));
  const relativeDirectories = scan.directories.map((directory) => safeRelative(workspace, directory));
  const markerEntries = uniqueStrings([...relativeFiles, ...relativeDirectories]);
  const extensionCounts = countExtensions(allFiles);
  const packages = await readWorkspacePackages(workspace, allFiles);
  const packageDependencies = collectPackageDependencies(packages);

  const candidates = SERVER_REGISTRY.map((server) => {
    const matchedExtensions = server.extensions
      .filter((extension) => extensionCounts[extension] > 0)
      .map((extension) => ({
        extension,
        count: extensionCounts[extension]
      }));
    const matchedMarkers = matchMarkers(server.markers ?? [], markerEntries);
    const matchedPackageDependencies = matchPackageDependencies(
      server.packageDeps ?? [],
      packageDependencies
    );
    const score = scoreCandidate({
      matchedExtensions,
      matchedMarkers,
      matchedPackageDependencies
    });

    if (score === 0) return null;
    if (
      server.requiresProjectSignal &&
      !matchedMarkers.length &&
      !matchedPackageDependencies.length
    ) {
      return null;
    }

    return {
      id: server.id,
      displayName: server.displayName,
      confidence: confidenceForScore(score),
      score,
      languageIds: server.languageIds,
      extensions: server.extensions,
      matchedExtensions,
      matchedMarkers,
      matchedPackageDependencies,
      command: server.command,
      install: installSummary(server),
      reasons: buildReasons({ matchedExtensions, matchedMarkers, matchedPackageDependencies })
    };
  })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.id.localeCompare(right.id);
    });

  return {
    workspace,
    scanned: {
      files: scan.files.length,
      directories: scan.directories.length,
      truncated: scan.truncated,
      maxFiles
    },
    packageFiles: packages.map((entry) => safeRelative(workspace, entry.file)),
    packageDependencies,
    candidates
  };
}

export async function scanWorkspace(workspace, options = {}) {
  const root = path.resolve(workspace);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const includeHidden = options.includeHidden ?? false;
  const files = [];
  const directories = [];
  let truncated = false;

  async function walk(directory) {
    if (truncated) return;

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (truncated) return;
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name, includeHidden)) continue;
        directories.push(fullPath);
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      files.push(fullPath);
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
    }
  }

  await walk(root);
  return { files, directories, truncated };
}

export function selectFilesForServer(server, files, limit = 40) {
  return files
    .filter((file) => serverSupportsFile(server, file))
    .slice(0, limit);
}

function shouldSkipDirectory(name, includeHidden) {
  if (IGNORED_DIRECTORIES.has(name)) return true;
  if (includeHidden) return false;
  if (!name.startsWith(".")) return false;
  return !HIDDEN_DIRECTORY_ALLOWLIST.has(name);
}

function normalizeInputFiles(workspace, files) {
  return uniqueStrings(
    files
      .filter((file) => typeof file === "string" && file.trim().length > 0)
      .map((file) => (path.isAbsolute(file) ? path.resolve(file) : path.resolve(workspace, file)))
  );
}

function countExtensions(files) {
  const counts = {};
  for (const file of files) {
    const extension = extensionForFile(file);
    if (!extension) continue;
    counts[extension] = (counts[extension] ?? 0) + 1;
  }
  return counts;
}

async function readWorkspacePackages(workspace, files) {
  const packageFiles = files.filter((file) => path.basename(file) === "package.json");
  const packages = [];

  for (const packageFile of packageFiles) {
    const relative = safeRelative(workspace, packageFile);
    if (relative.split(path.sep).includes("node_modules")) continue;

    try {
      const payload = JSON.parse(await fs.readFile(packageFile, "utf8"));
      packages.push({ file: packageFile, payload });
    } catch {
      packages.push({ file: packageFile, payload: null, unreadable: true });
    }
  }

  return packages;
}

function collectPackageDependencies(packages) {
  const dependencies = {};
  for (const entry of packages) {
    if (!entry.payload || typeof entry.payload !== "object") continue;
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies"
    ]) {
      const block = entry.payload[field];
      if (!block || typeof block !== "object") continue;
      for (const [name, version] of Object.entries(block)) {
        dependencies[name] ??= [];
        dependencies[name].push({
          version: String(version),
          packageFile: entry.file,
          field
        });
      }
    }
  }
  return dependencies;
}

function matchPackageDependencies(names, dependencies) {
  return names
    .filter((name) => dependencies[name])
    .map((name) => ({
      name,
      matches: dependencies[name].map((entry) => ({
        version: entry.version,
        packageFile: entry.packageFile,
        field: entry.field
      }))
    }));
}

function matchMarkers(markers, entries) {
  return markers.filter((marker) => entries.some((entry) => markerMatches(marker, entry)));
}

function markerMatches(marker, relativeEntry) {
  const normalizedMarker = marker.split(path.sep).join("/");
  const normalizedEntry = relativeEntry.split(path.sep).join("/");
  const base = path.basename(normalizedEntry);

  if (normalizedMarker.includes("*")) {
    return globToRegExp(normalizedMarker).test(normalizedEntry) ||
      globToRegExp(normalizedMarker).test(base);
  }

  if (normalizedMarker.includes("/")) {
    return normalizedEntry === normalizedMarker || normalizedEntry.startsWith(`${normalizedMarker}/`);
  }

  return base === normalizedMarker || normalizedEntry === normalizedMarker;
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function scoreCandidate({ matchedExtensions, matchedMarkers, matchedPackageDependencies }) {
  const extensionScore = matchedExtensions.reduce((sum, entry) => {
    if (entry.count >= 10) return sum + 6;
    if (entry.count >= 3) return sum + 4;
    return sum + 2;
  }, 0);

  return extensionScore + matchedMarkers.length * 6 + matchedPackageDependencies.length * 7;
}

function confidenceForScore(score) {
  if (score >= 8) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function buildReasons({ matchedExtensions, matchedMarkers, matchedPackageDependencies }) {
  const reasons = [];
  for (const marker of matchedMarkers) {
    reasons.push(`marker:${marker}`);
  }
  for (const dependency of matchedPackageDependencies) {
    reasons.push(`package:${dependency.name}`);
  }
  for (const extension of matchedExtensions) {
    reasons.push(`extension:${extension.extension}(${extension.count})`);
  }
  return reasons;
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function safeRelative(workspace, file) {
  const relative = path.relative(workspace, file);
  return relative || ".";
}
