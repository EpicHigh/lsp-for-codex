import path from "node:path";

export const DEFAULT_CACHE_DIR_NAME = "lsp-for-codex";

export const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".codex",
  ".claude",
  ".next",
  ".nuxt",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor"
]);

const jsTsExtensions = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts"
];

const jsTsVueExtensions = [...jsTsExtensions, ".vue"];

export const SERVER_REGISTRY = [
  {
    id: "astro",
    displayName: "Astro Language Server",
    languageIds: ["astro"],
    extensions: [".astro"],
    markers: ["astro.config.js", "astro.config.mjs", "astro.config.ts"],
    packageDeps: ["astro"],
    command: { binary: "astro-ls", args: ["--stdio"] },
    install: {
      type: "npm",
      packages: ["@astrojs/language-server@latest"],
      bin: "astro-ls",
      args: ["--stdio"]
    }
  },
  {
    id: "bash",
    displayName: "Bash Language Server",
    languageIds: ["shellscript"],
    extensions: [".sh", ".bash", ".zsh", ".ksh"],
    filenames: [".bashrc", ".zshrc"],
    markers: [".bashrc", ".zshrc"],
    command: { binary: "bash-language-server", args: ["start"] },
    install: {
      type: "npm",
      packages: ["bash-language-server@latest"],
      bin: "bash-language-server",
      args: ["start"]
    }
  },
  {
    id: "clangd",
    displayName: "clangd",
    languageIds: ["c", "cpp"],
    extensions: [".c", ".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".h++"],
    markers: ["compile_commands.json", "compile_flags.txt", "CMakeLists.txt"],
    command: { binary: "clangd", args: [] },
    requirements: ["clangd available on PATH"]
  },
  {
    id: "csharp",
    displayName: "C# Language Server",
    languageIds: ["csharp"],
    extensions: [".cs"],
    markers: ["*.sln", "*.csproj", "global.json"],
    command: { binary: "csharp-ls", args: [] },
    requirements: [".NET SDK and csharp-ls available on PATH"]
  },
  {
    id: "clojure-lsp",
    displayName: "clojure-lsp",
    languageIds: ["clojure"],
    extensions: [".clj", ".cljs", ".cljc", ".edn"],
    markers: ["deps.edn", "project.clj", "bb.edn"],
    command: { binary: "clojure-lsp", args: [] },
    requirements: ["clojure-lsp available on PATH"]
  },
  {
    id: "dart",
    displayName: "Dart Analysis Server",
    languageIds: ["dart"],
    extensions: [".dart"],
    markers: ["pubspec.yaml"],
    command: { binary: "dart", args: ["language-server", "--protocol=lsp"] },
    requirements: ["Dart SDK available on PATH"]
  },
  {
    id: "deno",
    displayName: "Deno Language Server",
    languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
    extensions: jsTsExtensions,
    markers: ["deno.json", "deno.jsonc"],
    requiresProjectSignal: true,
    command: { binary: "deno", args: ["lsp"] },
    requirements: ["deno available on PATH"]
  },
  {
    id: "elixir-ls",
    displayName: "ElixirLS",
    languageIds: ["elixir"],
    extensions: [".ex", ".exs"],
    markers: ["mix.exs"],
    command: { binary: "elixir-ls", args: [] },
    requirements: ["Elixir and ElixirLS available on PATH"]
  },
  {
    id: "eslint",
    displayName: "ESLint Language Server",
    languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact", "vue", "svelte", "astro"],
    extensions: jsTsVueExtensions.concat([".svelte", ".astro"]),
    markers: [
      ".eslintrc",
      ".eslintrc.cjs",
      ".eslintrc.js",
      ".eslintrc.json",
      ".eslintrc.yaml",
      ".eslintrc.yml",
      "eslint.config.cjs",
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.ts"
    ],
    packageDeps: ["eslint"],
    requiresProjectSignal: true,
    documentSymbols: false,
    command: { binary: "vscode-eslint-language-server", args: ["--stdio"] },
    install: {
      type: "npm",
      packages: ["vscode-langservers-extracted@latest"],
      bin: "vscode-eslint-language-server",
      args: ["--stdio"]
    },
    requirements: ["eslint dependency or config in the workspace"]
  },
  {
    id: "fsharp",
    displayName: "FsAutoComplete",
    languageIds: ["fsharp"],
    extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
    markers: ["*.fsproj", "*.sln"],
    command: { binary: "fsautocomplete", args: ["--adaptive-lsp-server-enabled"] },
    requirements: [".NET SDK and fsautocomplete available on PATH"]
  },
  {
    id: "gleam",
    displayName: "Gleam Language Server",
    languageIds: ["gleam"],
    extensions: [".gleam"],
    markers: ["gleam.toml"],
    command: { binary: "gleam", args: ["lsp"] },
    requirements: ["gleam available on PATH"]
  },
  {
    id: "gopls",
    displayName: "gopls",
    languageIds: ["go"],
    extensions: [".go"],
    markers: ["go.mod", "go.work"],
    command: { binary: "gopls", args: [] },
    requirements: ["Go toolchain and gopls available on PATH"]
  },
  {
    id: "jdtls",
    displayName: "Eclipse JDT LS",
    languageIds: ["java"],
    extensions: [".java"],
    markers: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
    command: { binary: "jdtls", args: [] },
    requirements: ["Java 21+ and jdtls available on PATH"]
  },
  {
    id: "kotlin-ls",
    displayName: "Kotlin Language Server",
    languageIds: ["kotlin"],
    extensions: [".kt", ".kts"],
    markers: ["build.gradle.kts", "settings.gradle.kts"],
    command: { binary: "kotlin-language-server", args: [] },
    requirements: ["kotlin-language-server available on PATH"]
  },
  {
    id: "lua-ls",
    displayName: "Lua Language Server",
    languageIds: ["lua"],
    extensions: [".lua"],
    markers: [".luarc.json", ".luarc.jsonc", "stylua.toml"],
    command: { binary: "lua-language-server", args: [] },
    requirements: ["lua-language-server available on PATH"]
  },
  {
    id: "nixd",
    displayName: "nixd",
    languageIds: ["nix"],
    extensions: [".nix"],
    markers: ["flake.nix", "default.nix"],
    command: { binary: "nixd", args: [] },
    requirements: ["nixd available on PATH"]
  },
  {
    id: "ocaml-lsp",
    displayName: "OCaml LSP",
    languageIds: ["ocaml"],
    extensions: [".ml", ".mli"],
    markers: ["dune-project", "dune", "*.opam"],
    command: { binary: "ocamllsp", args: [] },
    requirements: ["ocamllsp available on PATH"]
  },
  {
    id: "oxlint",
    displayName: "Oxlint Language Server",
    languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact", "vue", "svelte", "astro"],
    extensions: jsTsVueExtensions.concat([".astro", ".svelte"]),
    markers: [".oxlintrc.json", "oxlint.json"],
    packageDeps: ["oxlint"],
    requiresProjectSignal: true,
    documentSymbols: false,
    command: { binary: "oxlint", args: ["lsp"] },
    requirements: ["oxlint dependency or command available"]
  },
  {
    id: "php-intelephense",
    displayName: "PHP Intelephense",
    languageIds: ["php"],
    extensions: [".php"],
    markers: ["composer.json"],
    command: { binary: "intelephense", args: ["--stdio"] },
    install: {
      type: "npm",
      packages: ["intelephense@latest"],
      bin: "intelephense",
      args: ["--stdio"]
    }
  },
  {
    id: "prisma",
    displayName: "Prisma Language Server",
    languageIds: ["prisma"],
    extensions: [".prisma"],
    markers: ["schema.prisma"],
    packageDeps: ["prisma", "@prisma/client"],
    command: { binary: "prisma-language-server", args: ["--stdio"] },
    install: {
      type: "npm",
      packages: ["@prisma/language-server@latest"],
      bin: "prisma-language-server",
      args: ["--stdio"]
    }
  },
  {
    id: "pyright",
    displayName: "Pyright",
    languageIds: ["python"],
    extensions: [".py", ".pyi"],
    markers: ["pyproject.toml", "pyrightconfig.json", "setup.py", "requirements.txt"],
    packageDeps: ["pyright"],
    command: { binary: "pyright-langserver", args: ["--stdio"] },
    install: {
      type: "npm",
      packages: ["pyright@latest"],
      bin: "pyright-langserver",
      args: ["--stdio"]
    }
  },
  {
    id: "ruby-lsp",
    displayName: "Ruby LSP",
    languageIds: ["ruby"],
    extensions: [".rb", ".rake", ".gemspec", ".ru"],
    filenames: ["Gemfile", "Rakefile"],
    markers: ["Gemfile", "Rakefile", ".ruby-version"],
    command: { binary: "ruby-lsp", args: [] },
    requirements: ["ruby-lsp gem available on PATH"]
  },
  {
    id: "rust-analyzer",
    displayName: "rust-analyzer",
    languageIds: ["rust"],
    extensions: [".rs"],
    markers: ["Cargo.toml", "Cargo.lock"],
    command: { binary: "rust-analyzer", args: [] },
    requirements: ["rust-analyzer available on PATH"]
  },
  {
    id: "sourcekit-lsp",
    displayName: "SourceKit-LSP",
    languageIds: ["swift", "objective-c", "objective-cpp"],
    extensions: [".swift", ".m", ".mm"],
    markers: ["Package.swift", "*.xcodeproj", "*.xcworkspace"],
    command: { binary: "sourcekit-lsp", args: [] },
    requirements: ["Swift toolchain or Xcode sourcekit-lsp available on PATH"]
  },
  {
    id: "svelte",
    displayName: "Svelte Language Server",
    languageIds: ["svelte"],
    extensions: [".svelte"],
    markers: ["svelte.config.js", "svelte.config.mjs", "svelte.config.ts"],
    packageDeps: ["svelte"],
    command: { binary: "svelte-language-server", args: ["--stdio"] },
    install: {
      type: "npm",
      packages: ["svelte-language-server@latest", "typescript@latest"],
      bin: "svelte-language-server",
      args: ["--stdio"]
    }
  },
  {
    id: "terraform",
    displayName: "Terraform Language Server",
    languageIds: ["terraform", "terraform-vars"],
    extensions: [".tf", ".tfvars"],
    markers: [".terraform.lock.hcl"],
    command: { binary: "terraform-ls", args: ["serve"] },
    requirements: ["terraform-ls available on PATH"]
  },
  {
    id: "tinymist",
    displayName: "Tinymist",
    languageIds: ["typst"],
    extensions: [".typ", ".typc"],
    markers: ["typst.toml"],
    command: { binary: "tinymist", args: ["lsp"] },
    requirements: ["tinymist available on PATH"]
  },
  {
    id: "typescript",
    displayName: "TypeScript Language Server",
    languageIds: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
    extensions: jsTsExtensions,
    markers: ["package.json", "tsconfig.json", "jsconfig.json"],
    packageDeps: ["typescript"],
    command: { binary: "typescript-language-server", args: ["--stdio"] },
    install: {
      type: "npm",
      packages: ["typescript-language-server@latest", "typescript@latest"],
      bin: "typescript-language-server",
      args: ["--stdio"]
    }
  },
  {
    id: "vue",
    displayName: "Vue Language Server",
    languageIds: ["vue"],
    extensions: [".vue"],
    markers: ["vue.config.js", "vite.config.js", "vite.config.ts"],
    packageDeps: ["vue"],
    command: { binary: "vue-language-server", args: ["--stdio"] },
    install: {
      type: "npm",
      packages: ["@vue/language-server@latest", "typescript@latest"],
      bin: "vue-language-server",
      args: ["--stdio"]
    }
  },
  {
    id: "yaml-ls",
    displayName: "YAML Language Server",
    languageIds: ["yaml"],
    extensions: [".yaml", ".yml"],
    markers: [".yamllint", ".yamllint.yaml", ".github/workflows"],
    command: { binary: "yaml-language-server", args: ["--stdio"] },
    install: {
      type: "npm",
      packages: ["yaml-language-server@latest"],
      bin: "yaml-language-server",
      args: ["--stdio"]
    }
  },
  {
    id: "zls",
    displayName: "Zig Language Server",
    languageIds: ["zig"],
    extensions: [".zig", ".zon"],
    markers: ["build.zig", "build.zig.zon"],
    command: { binary: "zls", args: [] },
    requirements: ["zig and zls available on PATH"]
  }
];

const LANGUAGE_ID_BY_EXTENSION = new Map([
  [".astro", "astro"],
  [".bash", "shellscript"],
  [".c", "c"],
  [".c++", "cpp"],
  [".cjs", "javascript"],
  [".cc", "cpp"],
  [".clj", "clojure"],
  [".cljs", "clojure"],
  [".cljc", "clojure"],
  [".cpp", "cpp"],
  [".cs", "csharp"],
  [".cxx", "cpp"],
  [".dart", "dart"],
  [".edn", "clojure"],
  [".ex", "elixir"],
  [".exs", "elixir"],
  [".fs", "fsharp"],
  [".fsscript", "fsharp"],
  [".fsi", "fsharp"],
  [".fsx", "fsharp"],
  [".gemspec", "ruby"],
  [".gleam", "gleam"],
  [".go", "go"],
  [".h", "c"],
  [".h++", "cpp"],
  [".hh", "cpp"],
  [".hpp", "cpp"],
  [".hxx", "cpp"],
  [".java", "java"],
  [".js", "javascript"],
  [".jsx", "javascriptreact"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".ksh", "shellscript"],
  [".lua", "lua"],
  [".m", "objective-c"],
  [".mjs", "javascript"],
  [".ml", "ocaml"],
  [".mli", "ocaml"],
  [".mm", "objective-cpp"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".nix", "nix"],
  [".php", "php"],
  [".prisma", "prisma"],
  [".py", "python"],
  [".pyi", "python"],
  [".rake", "ruby"],
  [".rb", "ruby"],
  [".rs", "rust"],
  [".ru", "ruby"],
  [".sh", "shellscript"],
  [".svelte", "svelte"],
  [".swift", "swift"],
  [".tf", "terraform"],
  [".tfvars", "terraform-vars"],
  [".ts", "typescript"],
  [".tsx", "typescriptreact"],
  [".typ", "typst"],
  [".typc", "typst"],
  [".vue", "vue"],
  [".yaml", "yaml"],
  [".yml", "yaml"],
  [".zig", "zig"],
  [".zon", "zig"],
  [".zsh", "shellscript"]
]);

const LANGUAGE_ALIASES = new Map([
  ["bash", "shellscript"],
  ["c#", "csharp"],
  ["c++", "cpp"],
  ["cs", "csharp"],
  ["f#", "fsharp"],
  ["fs", "fsharp"],
  ["golang", "go"],
  ["js", "javascript"],
  ["jsx", "javascriptreact"],
  ["py", "python"],
  ["rb", "ruby"],
  ["shell", "shellscript"],
  ["sh", "shellscript"],
  ["tf", "terraform"],
  ["tfvars", "terraform-vars"],
  ["ts", "typescript"],
  ["tsx", "typescriptreact"],
  ["yml", "yaml"],
  ["zsh", "shellscript"]
]);

const PRIMARY_SERVER_BY_LANGUAGE = new Map([
  ["astro", "astro"],
  ["c", "clangd"],
  ["clojure", "clojure-lsp"],
  ["cpp", "clangd"],
  ["csharp", "csharp"],
  ["dart", "dart"],
  ["elixir", "elixir-ls"],
  ["fsharp", "fsharp"],
  ["gleam", "gleam"],
  ["go", "gopls"],
  ["java", "jdtls"],
  ["javascript", "typescript"],
  ["javascriptreact", "typescript"],
  ["kotlin", "kotlin-ls"],
  ["lua", "lua-ls"],
  ["nix", "nixd"],
  ["objective-c", "sourcekit-lsp"],
  ["objective-cpp", "sourcekit-lsp"],
  ["ocaml", "ocaml-lsp"],
  ["php", "php-intelephense"],
  ["prisma", "prisma"],
  ["python", "pyright"],
  ["ruby", "ruby-lsp"],
  ["rust", "rust-analyzer"],
  ["shellscript", "bash"],
  ["svelte", "svelte"],
  ["swift", "sourcekit-lsp"],
  ["terraform", "terraform"],
  ["terraform-vars", "terraform"],
  ["typescript", "typescript"],
  ["typescriptreact", "typescript"],
  ["typst", "tinymist"],
  ["vue", "vue"],
  ["yaml", "yaml-ls"],
  ["zig", "zls"]
]);

export function getServerById(id) {
  return SERVER_REGISTRY.find((server) => server.id === id);
}

export function extensionForFile(filePath) {
  const base = path.basename(filePath);
  if (base.endsWith(".gemspec")) return ".gemspec";
  if (base.endsWith(".fsscript")) return ".fsscript";
  return path.extname(base).toLowerCase();
}

export function languageIdForFile(filePath) {
  const base = path.basename(filePath);
  if (base === ".bashrc") return "shellscript";
  if (base === ".zshrc") return "shellscript";
  if (base === "Rakefile") return "ruby";
  if (base === "Gemfile") return "ruby";
  return LANGUAGE_ID_BY_EXTENSION.get(extensionForFile(filePath)) ?? "plaintext";
}

export function serverSupportsFile(server, filePath) {
  const base = path.basename(filePath);
  return (
    (server.filenames ?? []).includes(base) ||
    server.extensions.includes(extensionForFile(filePath))
  );
}

export function serverSupportsDocumentSymbols(server) {
  return server.documentSymbols !== false;
}

export function serverIdsForLanguages(languages = []) {
  const serverIds = [];
  const unknownLanguages = [];

  for (const rawLanguage of normalizeLanguageInputs(languages)) {
    const language = normalizeLanguageId(rawLanguage);
    const serverId = PRIMARY_SERVER_BY_LANGUAGE.get(language);
    if (!serverId) {
      unknownLanguages.push(rawLanguage);
      continue;
    }
    if (!serverIds.includes(serverId)) serverIds.push(serverId);
  }

  return { serverIds, unknownLanguages };
}

export function installSummary(server) {
  if (!server.install) {
    return {
      supported: false,
      kind: "manual",
      requirements: server.requirements ?? [`${server.command.binary} available on PATH`]
    };
  }

  return {
    supported: true,
    kind: server.install.type,
    packages: server.install.packages,
    bin: server.install.bin,
    args: server.install.args
  };
}

function normalizeLanguageId(language) {
  const value = String(language ?? "").trim().toLowerCase();
  return LANGUAGE_ALIASES.get(value) ?? value;
}

function normalizeLanguageInputs(languages) {
  const values = Array.isArray(languages) ? languages : [languages];
  return [...new Set(values.flatMap((value) => String(value ?? "").split(",")))]
    .map((value) => value.trim())
    .filter(Boolean);
}
