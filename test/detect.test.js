import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { installServers } from "../src/commands.js";
import { detectWorkspace, selectFilesForServer } from "../src/detect.js";
import {
  encodeLspMessage,
  fileUriToPath,
  pathToFileUri,
  readLspMessage
} from "../src/lsp-client.js";
import {
  collectDiagnostics,
  documentSymbols,
  installLanguageServers,
  supportedServers,
  workspaceStatus
} from "../src/manager.js";
import { SERVER_REGISTRY, languageIdForFile, serverIdsForLanguages } from "../src/registry.js";

const execFileAsync = promisify(execFile);

test("detects TypeScript and ESLint from package metadata and markers", async () => {
  const workspace = await tempWorkspace();
  await writeJson(path.join(workspace, "package.json"), {
    dependencies: {
      typescript: "^5.0.0"
    },
    devDependencies: {
      eslint: "^9.0.0"
    }
  });
  await fs.writeFile(path.join(workspace, "tsconfig.json"), "{}\n");
  await fs.writeFile(path.join(workspace, "eslint.config.js"), "export default [];\n");
  await fs.mkdir(path.join(workspace, "src"));
  await fs.writeFile(path.join(workspace, "src", "index.ts"), "export const value: string = 'ok';\n");

  const result = await detectWorkspace({ workspace });
  const ids = result.candidates.map((candidate) => candidate.id);

  assert.ok(ids.includes("typescript"));
  assert.ok(ids.includes("eslint"));
  assert.equal(result.candidates.find((candidate) => candidate.id === "typescript").confidence, "high");
});

test("detects Deno from deno markers", async () => {
  const workspace = await tempWorkspace();
  await fs.writeFile(path.join(workspace, "deno.json"), "{\"tasks\": {}}\n");
  await fs.writeFile(path.join(workspace, "mod.ts"), "export const value = 1;\n");

  const result = await detectWorkspace({ workspace });
  const deno = result.candidates.find((candidate) => candidate.id === "deno");

  assert.ok(deno);
  assert.equal(deno.confidence, "high");
  assert.ok(deno.reasons.includes("marker:deno.json"));
});

test("detects C# from normal project filenames", async () => {
  const workspace = await tempWorkspace();
  await fs.writeFile(path.join(workspace, "App.csproj"), "<Project />\n");

  const result = await detectWorkspace({ workspace });
  const csharp = result.candidates.find((candidate) => candidate.id === "csharp");

  assert.ok(csharp);
  assert.ok(csharp.reasons.includes("marker:*.csproj"));
});

test("detects F# from normal project filenames", async () => {
  const workspace = await tempWorkspace();
  await fs.writeFile(path.join(workspace, "App.fsproj"), "<Project />\n");

  const result = await detectWorkspace({ workspace });
  const fsharp = result.candidates.find((candidate) => candidate.id === "fsharp");

  assert.ok(fsharp);
  assert.ok(fsharp.reasons.includes("marker:*.fsproj"));
});

test("matches Ruby special filenames as supported Ruby files", () => {
  const ruby = SERVER_REGISTRY.find((server) => server.id === "ruby-lsp");

  assert.deepEqual(selectFilesForServer(ruby, ["Gemfile", "Rakefile", "README.md"]), [
    "Gemfile",
    "Rakefile"
  ]);
  assert.equal(languageIdForFile("Gemfile"), "ruby");
  assert.equal(languageIdForFile("Rakefile"), "ruby");
});

test("matches shell rc filenames as supported shell files", () => {
  const bash = SERVER_REGISTRY.find((server) => server.id === "bash");

  assert.deepEqual(selectFilesForServer(bash, [".bashrc", ".zshrc", "README.md"]), [
    ".bashrc",
    ".zshrc"
  ]);
  assert.equal(languageIdForFile(".bashrc"), "shellscript");
  assert.equal(languageIdForFile(".zshrc"), "shellscript");
});

test("resolves language selectors to primary server ids", () => {
  assert.deepEqual(serverIdsForLanguages(["typescript", "javascript", "go"]), {
    serverIds: ["typescript", "gopls"],
    unknownLanguages: []
  });
  assert.deepEqual(serverIdsForLanguages(["ts,js", "golang"]), {
    serverIds: ["typescript", "gopls"],
    unknownLanguages: []
  });
});

test("supported server matrix includes the issue target languages", () => {
  const ids = supportedServers().servers.map((server) => server.id);

  for (const id of [
    "typescript",
    "pyright",
    "gopls",
    "rust-analyzer",
    "terraform",
    "yaml-ls",
    "bash",
    "deno",
    "eslint",
    "vue",
    "svelte"
  ]) {
    assert.ok(ids.includes(id), `expected ${id}`);
  }
});

test("auto-install package specs use latest tag", () => {
  const nonLatestSpecs = [];

  for (const server of SERVER_REGISTRY) {
    for (const packageSpec of server.install?.packages ?? []) {
      if (!hasLatestTag(packageSpec)) {
        nonLatestSpecs.push(`${server.id}:${packageSpec}`);
      }
    }
  }

  assert.deepEqual(nonLatestSpecs, []);
});

test("symbols CLI preserves workspace positional when --file is used", async () => {
  const workspace = await tempWorkspace();
  await fs.writeFile(path.join(workspace, "index.ts"), "export const value = 1;\n");
  const cliPath = path.resolve("src", "cli.js");

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "symbols",
    workspace,
    "--file",
    "index.ts",
    "--server",
    "typescript",
    "--timeout",
    "100"
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.workspace, workspace);
  assert.equal(result.file, "index.ts");
});

test("symbols CLI passes explicit --server as the requested server", async () => {
  const workspace = await tempWorkspace();
  await writeJson(path.join(workspace, "package.json"), {
    devDependencies: {
      eslint: "^9.0.0",
      typescript: "^5.0.0"
    }
  });
  await fs.writeFile(path.join(workspace, "index.js"), "export const value = 1;\n");
  const cliPath = path.resolve("src", "cli.js");

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "symbols",
    workspace,
    "--file",
    "index.js",
    "--server",
    "eslint",
    "--timeout",
    "100"
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.serverId, "eslint");
  assert.equal(result.file, "index.js");
});

test("symbols CLI prefers symbol-capable server by default", async () => {
  const workspace = await tempWorkspace();
  await writeJson(path.join(workspace, "package.json"), {
    devDependencies: {
      eslint: "^9.0.0",
      typescript: "^5.0.0"
    }
  });
  await fs.writeFile(path.join(workspace, "eslint.config.js"), "export default [];\n");
  await fs.writeFile(path.join(workspace, "index.js"), "export const value = 1;\n");
  const cliPath = path.resolve("src", "cli.js");

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "symbols",
    workspace,
    "--file",
    "index.js",
    "--timeout",
    "100"
  ]);
  const result = JSON.parse(stdout);

  assert.equal(result.serverId, "typescript");
  assert.equal(result.file, "index.js");
});

test("install targets primary servers by language", async () => {
  const workspace = await tempWorkspace();

  const result = await installLanguageServers({
    workspace,
    languages: ["typescript", "javascript", "go"]
  });

  assert.deepEqual(result.results.map((entry) => entry.serverId), ["typescript", "gopls"]);
  assert.equal(result.results[0].status, "approval_required");
  assert.equal(result.results[1].status, "manual_requirement");
});

test("install CLI accepts language selectors", async () => {
  const workspace = await tempWorkspace();
  const cliPath = path.resolve("src", "cli.js");

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "install",
    workspace,
    "--language",
    "ts,js",
    "--language",
    "go"
  ]);
  const result = JSON.parse(stdout);

  assert.deepEqual(result.results.map((entry) => entry.serverId), ["typescript", "gopls"]);
});

test("install reports unknown languages", async () => {
  const workspace = await tempWorkspace();

  const result = await installLanguageServers({
    workspace,
    languages: ["typescript", "unknown-lang"]
  });

  assert.deepEqual(result.results.map((entry) => entry.status), [
    "unknown_language",
    "approval_required"
  ]);
  assert.equal(result.results[0].language, "unknown-lang");
});

test("diagnostics does not fall back for unknown language selectors", async () => {
  const workspace = await tempWorkspace();
  await fs.writeFile(path.join(workspace, "index.ts"), "export const value = 1;\n");

  const result = await collectDiagnostics({
    workspace,
    files: ["index.ts"],
    languages: ["typsecript"],
    installMissing: true,
    allowDownloads: true,
    timeoutMs: 100
  });

  assert.deepEqual(result.servers, [
    {
      language: "typsecript",
      available: false,
      skipped: true,
      reason: "unknown_language",
      diagnostics: []
    }
  ]);
});

test("symbols does not fall back for unknown language selectors", async () => {
  const workspace = await tempWorkspace();
  await fs.writeFile(path.join(workspace, "index.ts"), "export const value = 1;\n");

  const result = await documentSymbols({
    workspace,
    file: "index.ts",
    languages: ["typsecript"],
    timeoutMs: 100
  });

  assert.equal(result.reason, "unknown_language");
  assert.equal(result.language, "typsecript");
  assert.equal(result.serverId, undefined);
});

test("symbols rejects language targets that do not match the file", async () => {
  const workspace = await tempWorkspace();
  await fs.writeFile(path.join(workspace, "index.ts"), "export const value = 1;\n");

  const result = await documentSymbols({
    workspace,
    file: "index.ts",
    languages: ["go"],
    installMissing: true,
    allowDownloads: true,
    timeoutMs: 100
  });

  assert.equal(result.serverId, "gopls");
  assert.equal(result.reason, "no_matching_files");
  assert.equal(result.command, undefined);
});

test("diagnostics skips install for language targets that do not match files", { skip: process.platform === "win32" }, async () => {
  const workspace = await tempWorkspace();
  const cacheDir = await tempWorkspace();
  const pathBin = await tempWorkspace();
  const marker = path.join(workspace, "npm-called");
  await fs.writeFile(path.join(workspace, "index.ts"), "export const value = 1;\n");
  await writeExecutable(
    path.join(pathBin, "npm"),
    `#!/bin/sh\necho called > ${JSON.stringify(marker)}\nexit 0\n`
  );
  const originalPath = process.env.PATH;
  const originalCache = process.env.CODEX_LSP_CACHE;
  process.env.PATH = [pathBin, originalPath].filter(Boolean).join(path.delimiter);
  process.env.CODEX_LSP_CACHE = cacheDir;

  try {
    const result = await collectDiagnostics({
      workspace,
      files: ["index.ts"],
      languages: ["bash"],
      installMissing: true,
      allowDownloads: true,
      installTimeoutMs: 1000,
      timeoutMs: 100
    });

    assert.equal(result.servers[0].serverId, "bash");
    assert.equal(result.servers[0].reason, "no_matching_files");
    await assert.rejects(fs.access(marker));
  } finally {
    process.env.PATH = originalPath;
    if (originalCache === undefined) {
      delete process.env.CODEX_LSP_CACHE;
    } else {
      process.env.CODEX_LSP_CACHE = originalCache;
    }
  }
});

test("workspace status prefers workspace-local server binaries", async () => {
  const workspace = await tempWorkspace();
  await writeJson(path.join(workspace, "package.json"), {
    devDependencies: {
      typescript: "^5.0.0"
    }
  });
  await fs.mkdir(path.join(workspace, "node_modules", ".bin"), { recursive: true });
  const fakeBin = path.join(workspace, "node_modules", ".bin", "typescript-language-server");
  await fs.writeFile(fakeBin, "#!/bin/sh\nexit 0\n");
  await fs.chmod(fakeBin, 0o755);
  await fs.writeFile(path.join(workspace, "index.ts"), "export const value = 1;\n");

  const result = await workspaceStatus({ workspace, serverIds: ["typescript"] });
  const status = result.servers[0];

  assert.equal(status.available, true);
  assert.equal(status.source, "workspace");
  assert.equal(status.command, fakeBin);
});

test("install resolves npm only from PATH", { skip: process.platform === "win32" }, async () => {
  const workspace = await tempWorkspace();
  const cacheDir = await tempWorkspace();
  const pathBin = await tempWorkspace();
  await fs.mkdir(path.join(workspace, "node_modules", ".bin"), { recursive: true });
  await writeExecutable(
    path.join(workspace, "node_modules", ".bin", "npm"),
    "#!/bin/sh\necho workspace-npm >&2\nexit 42\n"
  );
  await writeExecutable(path.join(pathBin, "npm"), "#!/bin/sh\necho path-npm\nexit 0\n");
  const originalPath = process.env.PATH;
  process.env.PATH = [pathBin, originalPath].filter(Boolean).join(path.delimiter);

  try {
    const result = await installServers({
      workspace,
      cacheDir,
      serverIds: ["typescript"],
      allowDownloads: true,
      timeoutMs: 1000
    });
    const status = result.results[0];

    assert.notEqual(status.status, "install_failed");
    assert.equal(status.stdout, "path-npm");
    assert.doesNotMatch(`${status.message ?? ""}\n${status.stderr ?? ""}`, /workspace-npm/);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("diagnostics includes hidden files when requested", async () => {
  const workspace = await tempWorkspace();
  await fs.mkdir(path.join(workspace, ".hidden"), { recursive: true });
  await fs.writeFile(path.join(workspace, ".hidden", "app.py"), "print('ok')\n");

  const result = await collectDiagnostics({
    workspace,
    includeHidden: true,
    serverIds: ["pyright"],
    timeoutMs: 100
  });
  const status = result.servers[0];

  assert.ok(result.files.includes(path.join(".hidden", "app.py")));
  assert.notEqual(status.reason, "no_matching_files");
});

test("LSP framing parser reads one message and leaves the rest", () => {
  const first = encodeLspMessage({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  const second = encodeLspMessage({ jsonrpc: "2.0", method: "ping" });
  const parsed = readLspMessage(Buffer.concat([first, second]));

  assert.equal(parsed.message.id, 1);
  assert.deepEqual(parsed.message.result, { ok: true });
  assert.ok(parsed.rest.length > 0);

  const parsedSecond = readLspMessage(parsed.rest);
  assert.equal(parsedSecond.message.method, "ping");
});

test("file URI helpers round trip absolute paths", () => {
  const file = path.join(os.tmpdir(), "lsp for codex", "file.ts");
  const uri = pathToFileUri(file);

  assert.equal(fileUriToPath(uri), path.resolve(file));
  assert.ok(uri.startsWith("file://"));
});

test("registered extensions do not open as plaintext", () => {
  const missing = [];

  for (const server of SERVER_REGISTRY) {
    for (const extension of server.extensions) {
      if (languageIdForFile(`file${extension}`) === "plaintext") {
        missing.push(`${server.id}:${extension}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "lsp-for-codex-"));
}

async function writeJson(file, payload) {
  await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeExecutable(file, contents) {
  await fs.writeFile(file, contents);
  await fs.chmod(file, 0o755);
}

function hasLatestTag(packageSpec) {
  const versionIndex = packageSpec.startsWith("@")
    ? packageSpec.indexOf("@", 1)
    : packageSpec.indexOf("@");
  if (versionIndex < 0) return false;
  return packageSpec.slice(versionIndex + 1) === "latest";
}
