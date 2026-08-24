import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const EXECUTABLE_SEARCH_ENV_KEYS = [
  "BUN_INSTALL",
  "FNM_DIR",
  "NPM_CONFIG_PREFIX",
  "NVM_DIR",
  "PNPM_HOME",
  "SHELL",
  "VOLTA_HOME",
  "OPENMELD_DAEMON_RUNTIME_CODEX_BIN",
  "OPENMELD_EXECUTABLE_LOGIN_SHELL_TIMEOUT_MS",
];
const CHATGPT_CODEX_VERSION_PATTERN = /v0\.149\.0-alpha\.4\.3/u;
const SIGNED_IN_PATTERN = /Signed in/u;

test("Codex install discovery finds the bundled Codex.app binary outside degraded PATH", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "adapter-codex-app-"));
  const codexAppResourcesDir = join(
    fixtureDir,
    "Applications",
    "Codex.app",
    "Contents",
    "Resources"
  );
  const codexAppCommandPath = join(codexAppResourcesDir, "codex");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(codexAppResourcesDir, { recursive: true });
  await writeFile(codexAppCommandPath, fakeCodexSource("0.142.5"), "utf8");
  await chmod(codexAppCommandPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = "/usr/bin:/bin";
    process.env.BUN_INSTALL = join(fixtureDir, ".bun");
    process.env.FNM_DIR = join(fixtureDir, ".fnm");
    process.env.NPM_CONFIG_PREFIX = join(fixtureDir, ".npm-global");
    process.env.NVM_DIR = join(fixtureDir, ".nvm");
    process.env.PNPM_HOME = join(fixtureDir, ".local", "share", "pnpm");
    process.env.SHELL = "/bin/false";
    process.env.VOLTA_HOME = join(fixtureDir, ".volta");
    process.env.OPENMELD_EXECUTABLE_LOGIN_SHELL_TIMEOUT_MS = "100";
    Reflect.deleteProperty(process.env, "OPENMELD_DAEMON_RUNTIME_CODEX_BIN");

    const { resolveInstalledCodexLaunchCandidates } = await import(
      "../dist/index.js"
    );
    const resolution = await resolveInstalledCodexLaunchCandidates({
      appBundleRoots: [join(fixtureDir, "Applications")],
      timeoutMs: 1000,
    });

    if (!resolution.ok) {
      throw new Error(JSON.stringify(resolution));
    }
    if (
      !resolution.candidates.some(
        (candidate) => candidate.commandPath === codexAppCommandPath
      )
    ) {
      throw new Error(JSON.stringify(resolution));
    }
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("Codex install discovery finds the Codex bundled with ChatGPT outside degraded PATH", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "adapter-chatgpt-codex-"));
  const chatGptResourcesDir = join(
    fixtureDir,
    "Applications",
    "ChatGPT.app",
    "Contents",
    "Resources"
  );
  const chatGptCodexPath = join(chatGptResourcesDir, "codex");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(chatGptResourcesDir, { recursive: true });
  await writeFile(
    chatGptCodexPath,
    fakeCodexSource("0.149.0-alpha.4.3"),
    "utf8"
  );
  await chmod(chatGptCodexPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = "/usr/bin:/bin";
    process.env.BUN_INSTALL = join(fixtureDir, ".bun");
    process.env.FNM_DIR = join(fixtureDir, ".fnm");
    process.env.NPM_CONFIG_PREFIX = join(fixtureDir, ".npm-global");
    process.env.NVM_DIR = join(fixtureDir, ".nvm");
    process.env.PNPM_HOME = join(fixtureDir, ".local", "share", "pnpm");
    process.env.SHELL = "/bin/false";
    process.env.VOLTA_HOME = join(fixtureDir, ".volta");
    process.env.OPENMELD_EXECUTABLE_LOGIN_SHELL_TIMEOUT_MS = "100";
    Reflect.deleteProperty(process.env, "OPENMELD_DAEMON_RUNTIME_CODEX_BIN");

    const { resolveInstalledCodexLaunchCandidates } = await import(
      "../dist/index.js"
    );
    const resolution = await resolveInstalledCodexLaunchCandidates({
      appBundleRoots: [join(fixtureDir, "Applications")],
      timeoutMs: 1000,
    });

    if (!resolution.ok) {
      throw new Error(JSON.stringify(resolution));
    }
    if (
      !resolution.candidates.some(
        (candidate) => candidate.commandPath === chatGptCodexPath
      )
    ) {
      throw new Error(JSON.stringify(resolution));
    }
    const chatGptCandidate = resolution.candidates.find(
      (candidate) => candidate.commandPath === chatGptCodexPath
    );
    assert.equal(chatGptCandidate?.label, "ChatGPT app");
    assert.match(chatGptCandidate?.detail ?? "", CHATGPT_CODEX_VERSION_PATTERN);
    assert.match(chatGptCandidate?.detail ?? "", SIGNED_IN_PATTERN);
    assert.equal(resolution.preferredInstallId, chatGptCandidate?.installId);
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("Codex install discovery prefers signed-in ChatGPT Codex over a signed-in PATH install", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "adapter-codex-choice-"));
  const applicationsDir = join(fixtureDir, "Applications");
  const chatGptResourcesDir = join(
    applicationsDir,
    "ChatGPT.app",
    "Contents",
    "Resources"
  );
  const pathBinDir = join(fixtureDir, "bin");
  const chatGptCodexPath = join(chatGptResourcesDir, "codex");
  const pathCodexPath = join(pathBinDir, "codex");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(chatGptResourcesDir, { recursive: true });
  await mkdir(pathBinDir, { recursive: true });
  await writeFile(
    chatGptCodexPath,
    fakeCodexSource("0.149.0-alpha.4.3"),
    "utf8"
  );
  await writeFile(pathCodexPath, fakeCodexSource("0.149.1"), "utf8");
  await chmod(chatGptCodexPath, 0o755);
  await chmod(pathCodexPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = `${pathBinDir}:/usr/bin:/bin`;
    process.env.BUN_INSTALL = join(fixtureDir, ".bun");
    process.env.FNM_DIR = join(fixtureDir, ".fnm");
    process.env.NPM_CONFIG_PREFIX = join(fixtureDir, ".npm-global");
    process.env.NVM_DIR = join(fixtureDir, ".nvm");
    process.env.PNPM_HOME = join(fixtureDir, ".local", "share", "pnpm");
    process.env.SHELL = "/bin/false";
    process.env.VOLTA_HOME = join(fixtureDir, ".volta");
    process.env.OPENMELD_EXECUTABLE_LOGIN_SHELL_TIMEOUT_MS = "100";
    Reflect.deleteProperty(process.env, "OPENMELD_DAEMON_RUNTIME_CODEX_BIN");

    const { resolveInstalledCodexLaunchCandidates } = await import(
      "../dist/index.js"
    );
    const resolution = await resolveInstalledCodexLaunchCandidates({
      appBundleRoots: [applicationsDir],
      timeoutMs: 1000,
    });

    if (!resolution.ok) {
      throw new Error(JSON.stringify(resolution));
    }
    assert.equal(resolution.candidates.length, 2);
    const chatGptCandidate = resolution.candidates.find(
      (candidate) => candidate.commandPath === chatGptCodexPath
    );
    assert.equal(resolution.preferredInstallId, chatGptCandidate?.installId);

    await writeFile(
      chatGptCodexPath,
      fakeCodexSource("0.149.0-alpha.4.3", false),
      "utf8"
    );
    await chmod(chatGptCodexPath, 0o755);
    const signedOutResolution = await resolveInstalledCodexLaunchCandidates({
      appBundleRoots: [applicationsDir],
      timeoutMs: 1000,
    });
    if (!signedOutResolution.ok) {
      throw new Error(JSON.stringify(signedOutResolution));
    }
    const pathCandidate = signedOutResolution.candidates.find(
      (candidate) => candidate.commandPath === pathCodexPath
    );
    assert.equal(
      signedOutResolution.preferredInstallId,
      pathCandidate?.installId
    );
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

function fakeCodexSource(version, authenticated = true) {
  return [
    `#!${process.execPath}`,
    `if (process.argv[2] === "--version") { console.log("codex-cli ${version}"); process.exit(0); }`,
    'process.stdin.setEncoding("utf8");',
    'let buffer = "";',
    'const reply = (id, result) => process.stdout.write(JSON.stringify({ id, jsonrpc: "2.0", result }) + "\\n");',
    "const handle = (message) => {",
    `  if (message.method === "initialize") reply(message.id, { userAgent: "codex/${version} (test)" });`,
    authenticated
      ? '  if (message.method === "account/read") reply(message.id, { account: { email: "dev@example.com", type: "chatgpt" } });'
      : '  if (message.method === "account/read") reply(message.id, { account: null, requiresOpenaiAuth: true });',
    "};",
    'process.stdin.on("data", (chunk) => {',
    "  buffer += chunk;",
    '  let index = buffer.indexOf("\\n");',
    "  while (index >= 0) {",
    "    const line = buffer.slice(0, index).trim();",
    "    buffer = buffer.slice(index + 1);",
    "    if (line) handle(JSON.parse(line));",
    '    index = buffer.indexOf("\\n");',
    "  }",
    "});",
    "",
  ].join("\n");
}

function snapshotEnvVars(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvVars(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    restoreOptionalEnvVar(name, value);
  }
}

function restoreOptionalEnvVar(name, originalValue) {
  if (originalValue === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = originalValue;
}
