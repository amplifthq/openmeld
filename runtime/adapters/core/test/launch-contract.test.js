import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCliLaunchInvocation,
  materializeCliLaunchCommand,
  resolveExecutableOnPath,
  resolveExecutablePathsOnPath,
  resolveInstalledNodeScriptLaunchCandidates,
  resolveInstalledNodeScriptLaunchContract,
  resolveLaunchCandidatesAfterVerification,
  verifyCliLaunchContract,
} from "../dist/index.js";

const BROKEN_LAUNCH_CONTRACT_RE =
  /OpenClaw launch contract is broken on this device/i;
const EXECUTABLE_SEARCH_ENV_KEYS = [
  "NVM_DIR",
  "PNPM_HOME",
  "BUN_INSTALL",
  "VOLTA_HOME",
  "ASDF_DIR",
  "FNM_DIR",
  "NPM_CONFIG_PREFIX",
];

function restoreOptionalEnvVar(name, originalValue) {
  if (originalValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = originalValue;
}

function snapshotEnvVars(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvVars(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    restoreOptionalEnvVar(name, value);
  }
}

function isolateExecutableSearchEnv(fixtureDir) {
  process.env.NVM_DIR = join(fixtureDir, ".nvm");
  process.env.PNPM_HOME = join(fixtureDir, ".local", "share", "pnpm");
  process.env.BUN_INSTALL = join(fixtureDir, ".bun");
  process.env.VOLTA_HOME = join(fixtureDir, ".volta");
  process.env.ASDF_DIR = join(fixtureDir, ".asdf");
  process.env.FNM_DIR = join(fixtureDir, ".fnm");
  process.env.NPM_CONFIG_PREFIX = join(fixtureDir, ".npm-global");
}

async function withMockedPlatform(platform, callback) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "platform"
  );

  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  try {
    return await callback();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(process, "platform", originalDescriptor);
    }
  }
}

test("materializeCliLaunchCommand builds executable invocations", () => {
  const launchCommand = materializeCliLaunchCommand({
    args: ["--json", "hello"],
    launchContract: {
      kind: "executable",
      commandPath: "/tmp/codex",
      argsPrefix: ["exec"],
    },
  });

  assert.deepEqual(launchCommand, {
    argsPrefix: ["exec"],
    bin: "/tmp/codex",
  });
});

test("buildCliLaunchInvocation builds node script invocations", () => {
  const invocation = buildCliLaunchInvocation({
    args: ["agent", "--json"],
    launchContract: {
      kind: "node_script",
      nodePath: "/tmp/node",
      scriptPath: "/tmp/openclaw.mjs",
      argsPrefix: ["--dev"],
    },
  });

  assert.deepEqual(invocation, {
    args: ["/tmp/openclaw.mjs", "--dev", "agent", "--json"],
    bin: "/tmp/node",
  });
});

test("buildCliLaunchInvocation marks Windows batch wrappers as shell-backed commands", async () => {
  await withMockedPlatform("win32", () => {
    const invocation = buildCliLaunchInvocation({
      args: ["--version"],
      launchContract: {
        kind: "executable",
        commandPath: "C:\\Program Files\\nodejs\\openclaw.cmd",
      },
    });

    assert.deepEqual(invocation, {
      args: ["--version"],
      bin: "C:\\Program Files\\nodejs\\openclaw.cmd",
      shell: true,
    });
  });
});

test("restoreOptionalEnvVar removes PATH-like variables that were originally unset", () => {
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;

  try {
    process.env.PATH = "/tmp/adapter-core-path";
    process.env.PATHEXT = ".CMD;.EXE";

    restoreOptionalEnvVar("PATH", undefined);
    restoreOptionalEnvVar("PATHEXT", undefined);

    assert.equal("PATH" in process.env, false);
    assert.equal("PATHEXT" in process.env, false);
  } finally {
    restoreOptionalEnvVar("PATH", originalPath);
    restoreOptionalEnvVar("PATHEXT", originalPathExt);
  }
});

test("resolveExecutableOnPath accepts Windows command wrappers without POSIX execute bits", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "adapter-core-win-path-"));
  const commandPath = join(fixtureDir, "openclaw.cmd");
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;

  await writeFile(commandPath, "@echo off\r\necho openclaw\r\n", "utf8");

  try {
    process.env.PATH = fixtureDir;
    process.env.PATHEXT = ".CMD;.EXE";

    await withMockedPlatform("win32", () => {
      assert.equal(resolveExecutableOnPath("openclaw"), commandPath);
    });
  } finally {
    restoreOptionalEnvVar("PATH", originalPath);
    restoreOptionalEnvVar("PATHEXT", originalPathExt);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchContract falls back to an executable contract for Windows command wrappers", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-win-launch-contract-")
  );
  const commandPath = join(fixtureDir, "openclaw.cmd");

  await writeFile(commandPath, "@echo off\r\necho openclaw\r\n", "utf8");

  try {
    await withMockedPlatform("win32", async () => {
      const resolution = await resolveInstalledNodeScriptLaunchContract({
        commandName: "openclaw",
        configuredCommand: commandPath,
        displayName: "OpenClaw",
      });

      assert.equal(resolution.ok, true);
      if (!resolution.ok) {
        throw new Error("Expected Windows wrapper launch contract to resolve");
      }
      assert.equal(resolution.commandPath, commandPath);
      assert.deepEqual(resolution.launchContract, {
        kind: "executable",
        commandPath,
      });
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveExecutablePathsOnPath returns every matching PATH hit once", async () => {
  const fixtureDirA = await mkdtemp(join(tmpdir(), "adapter-core-path-a-"));
  const fixtureDirB = await mkdtemp(join(tmpdir(), "adapter-core-path-b-"));
  const commandPathA = join(fixtureDirA, "openclaw");
  const commandPathB = join(fixtureDirB, "openclaw");
  const originalPath = process.env.PATH;

  await writeFile(
    commandPathA,
    '#!/usr/bin/env node\nconsole.log("a");\n',
    "utf8"
  );
  await writeFile(
    commandPathB,
    '#!/usr/bin/env node\nconsole.log("b");\n',
    "utf8"
  );
  await chmod(commandPathA, 0o755);
  await chmod(commandPathB, 0o755);

  try {
    process.env.PATH = [fixtureDirA, fixtureDirB].join(":");
    assert.deepEqual(resolveExecutablePathsOnPath("openclaw"), [
      commandPathA,
      commandPathB,
    ]);
  } finally {
    restoreOptionalEnvVar("PATH", originalPath);
    await rm(fixtureDirA, { force: true, recursive: true });
    await rm(fixtureDirB, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates dedupes installs by canonical launch contract", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "adapter-core-candidates-"));
  const binDirA = join(fixtureDir, "bin-a");
  const binDirB = join(fixtureDir, "bin-b");
  const realBinDir = join(fixtureDir, "real-bin");
  const moduleDir = join(fixtureDir, "lib", "node_modules", "openclaw");
  const nodePath = join(realBinDir, "node");
  const scriptPath = join(moduleDir, "openclaw.mjs");
  const commandPathA = join(binDirA, "openclaw");
  const commandPathB = join(binDirB, "openclaw");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await Promise.all([
    mkdir(realBinDir, { recursive: true }),
    mkdir(moduleDir, { recursive: true }),
    mkdir(binDirA, { recursive: true }),
    mkdir(binDirB, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(nodePath, "#!/bin/sh\nexit 0\n", "utf8"),
    writeFile(
      scriptPath,
      "#!/usr/bin/env node\nconsole.log('openclaw');\n",
      "utf8"
    ),
  ]);
  await chmod(nodePath, 0o755);
  await chmod(scriptPath, 0o755);
  await symlink(join(realBinDir, "openclaw"), commandPathA).catch(() => null);
  await symlink(join(realBinDir, "openclaw"), commandPathB).catch(() => null);
  await writeFile(
    join(realBinDir, "openclaw"),
    "#!/usr/bin/env node\nconsole.log('openclaw');\n",
    "utf8"
  );
  await chmod(join(realBinDir, "openclaw"), 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = [binDirA, binDirB].join(":");
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "openclaw",
      displayName: "OpenClaw",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected launch candidates to resolve");
    }
    assert.equal(resolution.candidates.length, 1);
    assert.equal(
      resolution.candidates[0]?.label.toLowerCase().includes("install"),
      true
    );
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates keeps a stable symlink contract across managed updates", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-managed-update-")
  );
  const binDir = join(fixtureDir, "bin");
  const versionsDir = join(fixtureDir, "versions");
  const oldVersionDir = join(versionsDir, "2026.07.16-old");
  const newVersionDir = join(versionsDir, "2026.08.04-new");
  const commandPath = join(binDir, "cursor-agent");
  const oldScriptPath = join(oldVersionDir, "cursor-agent");
  const newScriptPath = join(newVersionDir, "cursor-agent");

  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(oldVersionDir, { recursive: true }),
    mkdir(newVersionDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(oldScriptPath, "#!/usr/bin/env bash\nexit 0\n", "utf8"),
    writeFile(newScriptPath, "#!/usr/bin/env bash\nexit 0\n", "utf8"),
  ]);
  await Promise.all([chmod(oldScriptPath, 0o755), chmod(newScriptPath, 0o755)]);
  await symlink(oldScriptPath, commandPath);

  try {
    const oldResolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "cursor-agent",
      configuredCommand: commandPath,
      displayName: "Cursor CLI",
    });
    assert.equal(oldResolution.ok, true);
    if (!oldResolution.ok) {
      throw new Error("Expected the old managed install to resolve");
    }

    await rm(commandPath);
    await symlink(newScriptPath, commandPath);

    const newResolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "cursor-agent",
      configuredCommand: commandPath,
      displayName: "Cursor CLI",
    });
    assert.equal(newResolution.ok, true);
    if (!newResolution.ok) {
      throw new Error("Expected the updated managed install to resolve");
    }

    assert.deepEqual(oldResolution.candidates[0]?.launchContract, {
      kind: "node_script",
      nodePath: "/usr/bin/env",
      scriptPath: commandPath,
    });
    assert.deepEqual(newResolution.candidates[0]?.launchContract, {
      kind: "node_script",
      nodePath: "/usr/bin/env",
      scriptPath: commandPath,
    });
    assert.equal(
      newResolution.candidates[0]?.installId,
      oldResolution.candidates[0]?.installId
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates labels common local installs clearly", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-local-install-labels-")
  );
  const userLocalBinDir = join(fixtureDir, "Users", "demo", ".local", "bin");
  const systemLocalBinDir = join(fixtureDir, "usr", "local", "bin");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await Promise.all([
    mkdir(userLocalBinDir, { recursive: true }),
    mkdir(systemLocalBinDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(userLocalBinDir, "claude"),
      "#!/usr/bin/env node\nconsole.log('claude');\n",
      "utf8"
    ),
    writeFile(
      join(systemLocalBinDir, "claude"),
      "#!/usr/bin/env node\nconsole.log('claude');\n",
      "utf8"
    ),
    writeFile(join(userLocalBinDir, "node"), "#!/bin/sh\nexit 0\n", "utf8"),
    writeFile(join(systemLocalBinDir, "node"), "#!/bin/sh\nexit 0\n", "utf8"),
  ]);
  await Promise.all([
    chmod(join(userLocalBinDir, "claude"), 0o755),
    chmod(join(systemLocalBinDir, "claude"), 0o755),
    chmod(join(userLocalBinDir, "node"), 0o755),
    chmod(join(systemLocalBinDir, "node"), 0o755),
  ]);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = [userLocalBinDir, systemLocalBinDir].join(":");
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "claude",
      displayName: "Claude Code",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected local install candidates to resolve");
    }

    assert.equal(resolution.candidates[0]?.label, "User install");
    assert.equal(resolution.candidates[0]?.detail, `${userLocalBinDir}`);
    assert.equal(resolution.candidates[1]?.label, "System-wide install");
    assert.equal(resolution.candidates[1]?.detail, `${systemLocalBinDir}`);
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates ignores temporary PATH wrappers when a stable install exists", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-temp-wrapper-filter-")
  );
  const userLocalBinDir = join(fixtureDir, "Users", "demo", ".local", "bin");
  const wrapperDir = join(fixtureDir, "cmux-cli-shims", "session-a");
  const wrapperPath = join(wrapperDir, "claude");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await Promise.all([
    mkdir(userLocalBinDir, { recursive: true }),
    mkdir(wrapperDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(userLocalBinDir, "claude"),
      "#!/usr/bin/env node\nconsole.log('claude');\n",
      "utf8"
    ),
    writeFile(join(userLocalBinDir, "node"), "#!/bin/sh\nexit 0\n", "utf8"),
    writeFile(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        `export CMUX_CLAUDE_WRAPPER_SHIM="${wrapperPath}"`,
        `export CMUX_CLAUDE_WRAPPER_SHIM_ROOT="${wrapperDir}"`,
        'exec "/Applications/cmux.app/Contents/Resources/bin/cmux-claude-wrapper" "$@"',
        "",
      ].join("\n"),
      "utf8"
    ),
  ]);
  await Promise.all([
    chmod(join(userLocalBinDir, "claude"), 0o755),
    chmod(join(userLocalBinDir, "node"), 0o755),
    chmod(wrapperPath, 0o755),
  ]);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = [userLocalBinDir, wrapperDir].join(":");
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "claude",
      displayName: "Claude Code",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected launch candidates to resolve");
    }

    assert.equal(resolution.candidates.length, 1);
    assert.equal(
      resolution.candidates[0]?.commandPath,
      join(userLocalBinDir, "claude")
    );
    assert.equal(resolution.candidates[0]?.label, "User install");
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates keeps only temporary PATH wrappers but labels them clearly", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-temp-wrapper-label-")
  );
  const wrapperDir = join(fixtureDir, "cmux-cli-shims", "session-a");
  const wrapperPath = join(wrapperDir, "claude");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(wrapperDir, { recursive: true });
  await writeFile(
    wrapperPath,
    [
      "#!/usr/bin/env bash",
      `export CMUX_CLAUDE_WRAPPER_SHIM="${wrapperPath}"`,
      `export CMUX_CLAUDE_WRAPPER_SHIM_ROOT="${wrapperDir}"`,
      'exec "/Applications/cmux.app/Contents/Resources/bin/cmux-claude-wrapper" "$@"',
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(wrapperPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = wrapperDir;
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "claude",
      displayName: "Claude Code",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected wrapper candidate to resolve");
    }

    assert.equal(resolution.candidates.length, 1);
    assert.equal(resolution.candidates[0]?.label, "Temporary wrapper");
    assert.equal(
      resolution.candidates[0]?.detail,
      `Temporary PATH wrapper · ${wrapperDir}`
    );
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates keeps a saved temporary wrapper beside stable installs", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-saved-choice-")
  );
  const wrapperDir = join(fixtureDir, "cmux-cli-shims", "session-a");
  const stableBinDir = join(fixtureDir, ".local", "bin");
  const wrapperPath = join(wrapperDir, "claude");
  const stablePath = join(stableBinDir, "claude");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await Promise.all([
    mkdir(wrapperDir, { recursive: true }),
    mkdir(stableBinDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        `export CMUX_CLAUDE_WRAPPER_SHIM="${wrapperPath}"`,
        `export CMUX_CLAUDE_WRAPPER_SHIM_ROOT="${wrapperDir}"`,
        'exec "/Applications/cmux.app/Contents/Resources/bin/cmux-claude-wrapper" "$@"',
        "",
      ].join("\n"),
      "utf8"
    ),
    writeFile(stablePath, "#!/usr/bin/env bash\nexit 0\n", "utf8"),
  ]);
  await Promise.all([chmod(wrapperPath, 0o755), chmod(stablePath, 0o755)]);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = stableBinDir;
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "claude",
      displayName: "Claude Code",
      preferredLaunchContract: {
        kind: "node_script",
        nodePath: "/usr/bin/env",
        scriptPath: wrapperPath,
      },
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected saved wrapper and stable install to resolve");
    }

    assert.deepEqual(
      resolution.candidates.map((candidate) => candidate.commandPath),
      [wrapperPath, stablePath]
    );
    assert.equal(resolution.candidates[0]?.label, "Temporary wrapper");
    assert.equal(resolution.candidates[1]?.label, "User install");
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates bounds executable content inspection", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-bounded-executable-inspection-")
  );
  const commandPath = join(fixtureDir, "claude");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await writeFile(
    commandPath,
    `#!/bin/sh\n${" ".repeat(128 * 1024)}\nexec /tmp/provider-wrapper "$@"\n`,
    "utf8"
  );
  await chmod(commandPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = fixtureDir;
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "claude",
      displayName: "Claude Code",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected launch candidate to resolve");
    }
    assert.notEqual(resolution.candidates[0]?.label, "Temporary wrapper");
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates labels app bundle installs clearly", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-app-install-labels-")
  );
  const appBundleBinDir = join(
    fixtureDir,
    "Applications",
    "Claude Code.app",
    "Contents",
    "Resources",
    "bin"
  );
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(appBundleBinDir, { recursive: true });
  await Promise.all([
    writeFile(
      join(appBundleBinDir, "claude"),
      "#!/usr/bin/env node\nconsole.log('claude');\n",
      "utf8"
    ),
    writeFile(join(appBundleBinDir, "node"), "#!/bin/sh\nexit 0\n", "utf8"),
  ]);
  await Promise.all([
    chmod(join(appBundleBinDir, "claude"), 0o755),
    chmod(join(appBundleBinDir, "node"), 0o755),
  ]);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = appBundleBinDir;
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "claude",
      displayName: "Claude Code",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected app install candidates to resolve");
    }

    assert.equal(resolution.candidates[0]?.label, "App install");
    assert.equal(resolution.candidates[0]?.detail, `${appBundleBinDir}`);
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates finds user bin installs outside degraded PATH", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-known-user-bin-")
  );
  const userBinDir = join(fixtureDir, ".local", "bin");
  const commandPath = join(userBinDir, "fixture-agent");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(userBinDir, { recursive: true });
  await writeFile(
    commandPath,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo fixture-agent; fi\n',
    "utf8"
  );
  await chmod(commandPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = "/usr/bin:/bin";
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "fixture-agent",
      displayName: "Fixture Agent",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected user bin install to resolve");
    }
    assert.equal(resolution.candidates[0]?.commandPath, commandPath);
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates includes a saved install outside discovery paths", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-saved-install-")
  );
  const savedBinDir = join(fixtureDir, "saved", "bin");
  const commandPath = join(savedBinDir, "fixture-agent");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(savedBinDir, { recursive: true });
  await writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(commandPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = "/usr/bin:/bin";
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "fixture-agent",
      displayName: "Fixture Agent",
      preferredLaunchContract: {
        commandPath,
        kind: "executable",
      },
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected the saved install to remain discoverable");
    }
    assert.equal(resolution.candidates[0]?.commandPath, commandPath);
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates finds caller-provided app bundle directories outside degraded PATH", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "adapter-core-app-bundle-"));
  const appResourcesDir = join(
    fixtureDir,
    "Applications",
    "Fixture.app",
    "Contents",
    "Resources"
  );
  const commandPath = join(appResourcesDir, "fixture-agent");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(appResourcesDir, { recursive: true });
  await writeFile(
    commandPath,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo fixture-agent; fi\n',
    "utf8"
  );
  await chmod(commandPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = "/usr/bin:/bin";
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      additionalCommandDirectories: [appResourcesDir],
      commandName: "fixture-agent",
      displayName: "Fixture Agent",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected app bundle install to resolve");
    }
    assert.equal(resolution.candidates[0]?.commandPath, commandPath);
    assert.equal(resolution.candidates[0]?.label, "App install");
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates prefers known stable installs over temporary PATH wrappers", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-known-stable-install-")
  );
  const userBinDir = join(fixtureDir, ".local", "bin");
  const wrapperDir = join(fixtureDir, "cmux-cli-shims", "session-a");
  const commandPath = join(userBinDir, "claude");
  const wrapperPath = join(wrapperDir, "claude");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(userBinDir, { recursive: true });
  await mkdir(wrapperDir, { recursive: true });
  await writeFile(
    commandPath,
    "#!/usr/bin/env node\nconsole.log('claude');\n",
    "utf8"
  );
  await writeFile(join(userBinDir, "node"), "#!/bin/sh\nexit 0\n", "utf8");
  await writeFile(
    wrapperPath,
    [
      "#!/usr/bin/env bash",
      `export CMUX_CLAUDE_WRAPPER_SHIM="${wrapperPath}"`,
      `export CMUX_CLAUDE_WRAPPER_SHIM_ROOT="${wrapperDir}"`,
      'exec "/Applications/cmux.app/Contents/Resources/bin/cmux-claude-wrapper" "$@"',
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(commandPath, 0o755);
  await chmod(join(userBinDir, "node"), 0o755);
  await chmod(wrapperPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = wrapperDir;
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "claude",
      displayName: "Claude Code",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected known stable install to resolve");
    }
    assert.equal(resolution.candidates.length, 1);
    assert.equal(resolution.candidates[0]?.commandPath, commandPath);
    assert.equal(resolution.candidates[0]?.label, "User install");
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates finds nvm default alias installs outside degraded PATH", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "adapter-core-nvm-bin-"));
  const nvmBinDir = join(
    fixtureDir,
    ".nvm",
    "versions",
    "node",
    "v22.1.0",
    "bin"
  );
  const moduleDir = join(
    fixtureDir,
    ".nvm",
    "versions",
    "node",
    "v22.1.0",
    "lib",
    "node_modules",
    "nvm-agent",
    "bin"
  );
  const commandPath = join(nvmBinDir, "nvm-agent");
  const nodePath = join(nvmBinDir, "node");
  const scriptPath = join(moduleDir, "nvm-agent.js");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(join(fixtureDir, ".nvm", "alias"), { recursive: true });
  await mkdir(nvmBinDir, { recursive: true });
  await mkdir(moduleDir, { recursive: true });
  await writeFile(join(fixtureDir, ".nvm", "alias", "default"), "v22.1.0\n");
  await writeFile(
    scriptPath,
    "#!/usr/bin/env node\nif (process.argv.includes('--version')) console.log('nvm-agent');\n",
    "utf8"
  );
  await symlink(process.execPath, nodePath);
  await symlink(scriptPath, commandPath);
  await chmod(scriptPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = "/usr/bin:/bin";
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "nvm-agent",
      displayName: "Nvm Agent",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected nvm install to resolve");
    }
    assert.equal(resolution.candidates[0]?.commandPath, commandPath);
    assert.deepEqual(resolution.candidates[0]?.launchContract, {
      kind: "node_script",
      nodePath,
      scriptPath: commandPath,
    });
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates falls back to a cached login shell lookup", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "adapter-core-shell-bin-"));
  const shellBinDir = join(fixtureDir, "shell-bin");
  const fakeShellPath = join(fixtureDir, "fake-shell");
  const shellLogPath = join(fixtureDir, "shell.log");
  const commandPath = join(shellBinDir, "shell-agent");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalShell = process.env.SHELL;
  const originalLoginShellBin = process.env.LOGIN_SHELL_BIN;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await mkdir(shellBinDir, { recursive: true });
  await writeFile(
    commandPath,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo shell-agent; fi\n',
    "utf8"
  );
  await writeFile(
    fakeShellPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$2" >> "${shellLogPath}"`,
      "printf '%s\\n' \"$LOGIN_SHELL_BIN/shell-agent\"",
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(commandPath, 0o755);
  await chmod(fakeShellPath, 0o755);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = "/usr/bin:/bin";
    process.env.SHELL = fakeShellPath;
    process.env.LOGIN_SHELL_BIN = shellBinDir;
    isolateExecutableSearchEnv(fixtureDir);

    for (let index = 0; index < 2; index += 1) {
      const resolution = await resolveInstalledNodeScriptLaunchCandidates({
        commandName: "shell-agent",
        displayName: "Shell Agent",
      });

      assert.equal(resolution.ok, true);
      if (!resolution.ok) {
        throw new Error("Expected login shell install to resolve");
      }
      assert.equal(resolution.candidates[0]?.commandPath, commandPath);
    }

    const shellLog = await readFile(shellLogPath, "utf8");
    assert.equal(shellLog.trim().split("\n").length, 1);
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreOptionalEnvVar("SHELL", originalShell);
    restoreOptionalEnvVar("LOGIN_SHELL_BIN", originalLoginShellBin);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("resolveInstalledNodeScriptLaunchCandidates disambiguates duplicate generic install labels", async () => {
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "adapter-core-install-label-disambiguation-")
  );
  const vendorBinDirA = join(fixtureDir, "vendor-a", "bin");
  const vendorBinDirB = join(fixtureDir, "vendor-b", "bin");
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalSearchEnv = snapshotEnvVars(EXECUTABLE_SEARCH_ENV_KEYS);

  await Promise.all([
    mkdir(vendorBinDirA, { recursive: true }),
    mkdir(vendorBinDirB, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(vendorBinDirA, "claude"),
      "#!/usr/bin/env node\nconsole.log('claude-a');\n",
      "utf8"
    ),
    writeFile(
      join(vendorBinDirB, "claude"),
      "#!/usr/bin/env node\nconsole.log('claude-b');\n",
      "utf8"
    ),
    writeFile(join(vendorBinDirA, "node"), "#!/bin/sh\nexit 0\n", "utf8"),
    writeFile(join(vendorBinDirB, "node"), "#!/bin/sh\nexit 0\n", "utf8"),
  ]);
  await Promise.all([
    chmod(join(vendorBinDirA, "claude"), 0o755),
    chmod(join(vendorBinDirB, "claude"), 0o755),
    chmod(join(vendorBinDirA, "node"), 0o755),
    chmod(join(vendorBinDirB, "node"), 0o755),
  ]);

  try {
    process.env.HOME = fixtureDir;
    process.env.PATH = [vendorBinDirA, vendorBinDirB].join(":");
    isolateExecutableSearchEnv(fixtureDir);
    const resolution = await resolveInstalledNodeScriptLaunchCandidates({
      commandName: "claude",
      displayName: "Claude Code",
    });

    assert.equal(resolution.ok, true);
    if (!resolution.ok) {
      throw new Error("Expected generic install candidates to resolve");
    }

    const labels = resolution.candidates.map((candidate) => candidate.label);
    assert.equal(labels.length, 2);
    assert.equal(new Set(labels).size, 2);
    assert.equal(
      labels.every((label) => label.startsWith("Other install (")),
      true
    );
  } finally {
    restoreOptionalEnvVar("HOME", originalHome);
    restoreOptionalEnvVar("PATH", originalPath);
    restoreEnvVars(originalSearchEnv);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("verifyCliLaunchContract does not guess PATH for executable launch contracts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "adapter-core-launch-"));

  try {
    const result = await verifyCliLaunchContract({
      cwd,
      displayName: "OpenClaw",
      launchContract: {
        kind: "executable",
        commandPath: "openclaw",
      },
      probeArgs: ["--version"],
      timeoutMs: 1000,
    });

    assert.equal(result.ok, false);
    assert.match(result.errorMessage, BROKEN_LAUNCH_CONTRACT_RE);
    assert.equal(result.failureKind, "completed_negative");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("verifyCliLaunchContract distinguishes an incomplete timeout from a completed negative check", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "adapter-core-launch-"));
  const timeoutScriptPath = join(cwd, "timeout.mjs");
  const failureScriptPath = join(cwd, "failure.mjs");
  const interruptedScriptPath = join(cwd, "interrupted.mjs");

  await writeFile(
    timeoutScriptPath,
    "await new Promise((resolve) => setTimeout(resolve, 250));\n",
    "utf8"
  );
  await writeFile(failureScriptPath, "process.exitCode = 1;\n", "utf8");
  await writeFile(
    interruptedScriptPath,
    'process.kill(process.pid, "SIGTERM");\n',
    "utf8"
  );

  try {
    const incompleteResult = await verifyCliLaunchContract({
      cwd,
      displayName: "Slow CLI",
      launchContract: {
        kind: "node_script",
        nodePath: process.execPath,
        scriptPath: timeoutScriptPath,
      },
      probeArgs: ["--version"],
      timeoutMs: 25,
    });
    const completedNegativeResult = await verifyCliLaunchContract({
      cwd,
      displayName: "Broken CLI",
      launchContract: {
        kind: "node_script",
        nodePath: process.execPath,
        scriptPath: failureScriptPath,
      },
      probeArgs: ["--version"],
      timeoutMs: 1000,
    });
    const interruptedResult = await verifyCliLaunchContract({
      cwd,
      displayName: "Interrupted CLI",
      launchContract: {
        kind: "node_script",
        nodePath: process.execPath,
        scriptPath: interruptedScriptPath,
      },
      probeArgs: ["--version"],
      timeoutMs: 1000,
    });

    assert.equal(incompleteResult.ok, false);
    assert.equal(incompleteResult.failureKind, "incomplete_check");
    assert.equal(completedNegativeResult.ok, false);
    assert.equal(completedNegativeResult.failureKind, "completed_negative");
    assert.equal(interruptedResult.ok, false);
    assert.equal(interruptedResult.failureKind, "incomplete_check");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("launch candidate verification preserves incomplete checks only when no candidate verifies", async () => {
  const verifiedCandidate = createLaunchCandidate("verified", "/bin/verified");
  const incompleteCandidate = createLaunchCandidate(
    "incomplete",
    "/bin/incomplete"
  );
  const brokenCandidate = createLaunchCandidate("broken", "/bin/broken");
  const verify = (candidate) => {
    if (candidate.installId === "verified") {
      return Promise.resolve({
        launchCommand: { argsPrefix: [], bin: candidate.commandPath },
        ok: true,
      });
    }
    return Promise.resolve({
      errorMessage: `${candidate.installId} did not verify`,
      failureKind:
        candidate.installId === "incomplete"
          ? "incomplete_check"
          : "completed_negative",
      ok: false,
    });
  };

  assert.deepEqual(
    await resolveLaunchCandidatesAfterVerification({
      candidates: [verifiedCandidate, incompleteCandidate, brokenCandidate],
      verify,
    }),
    [verifiedCandidate]
  );
  assert.deepEqual(
    await resolveLaunchCandidatesAfterVerification({
      candidates: [incompleteCandidate, brokenCandidate],
      verify,
    }),
    [incompleteCandidate]
  );
});

function createLaunchCandidate(installId, commandPath) {
  return {
    commandPath,
    detail: commandPath,
    installId,
    label: installId,
    launchContract: {
      commandPath,
      kind: "executable",
    },
    source: "path",
  };
}

test("verifyCliLaunchContract verifies node script launch contracts with explicit paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "adapter-core-launch-"));
  const scriptPath = join(cwd, "fixture.mjs");

  await writeFile(
    scriptPath,
    '#!/usr/bin/env node\nconsole.log("fixture 1.0.0");\n',
    "utf8"
  );
  await chmod(scriptPath, 0o755);

  try {
    const result = await verifyCliLaunchContract({
      cwd,
      displayName: "Fixture CLI",
      launchContract: {
        kind: "node_script",
        nodePath: process.execPath,
        scriptPath,
      },
      probeArgs: ["--version"],
      timeoutMs: 2000,
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      throw new Error(
        "Expected node script launch contract verification to succeed"
      );
    }
    assert.equal(result.launchCommand.bin, process.execPath);
    assert.deepEqual(result.launchCommand.argsPrefix, [scriptPath]);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
