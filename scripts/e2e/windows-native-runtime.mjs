// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone native acceptance entrypoint; failed assertions must exit nonzero.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnAgentControllerProcess } from "../../runtime/adapters/core/dist/index.js";
import {
  buildBunCompileArgs,
  collectCliBinaryMetadata,
  resolveCliPackageVersion,
} from "../release/build-cli-binary.mjs";

assert.equal(process.platform, "win32", "Native Windows execution is required");
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const evidence = path.join(repo, "dev-tmp/windows-native-evidence");
await mkdir(evidence, { recursive: true });
const version = resolveCliPackageVersion();
// The process helper is part of the delivered version bundle, shared by both
// product executables and the compiled component peers.
const helper = path.join(repo, "cli/dist/openmeld-windows-process.exe");
await copyFile(helper, path.join(evidence, "openmeld-windows-process.exe"));
const binaries = {};
binaries.helper = { path: helper, ...collectCliBinaryMetadata(helper) };
for (const name of [
  "windows-agent-sdk",
  "windows-native-runtime",
  "windows-native-codex",
  "windows-managed-launcher",
]) {
  const outFile = path.join(evidence, `${name}.exe`);
  const build = spawnSync(
    "bun",
    buildBunCompileArgs({
      bunTarget: "bun-windows-x64",
      version,
      outFile,
      entry: path.join(
        repo,
        "clients/openmeld-cli/tests/fixtures",
        `${name}.ts`
      ),
    }),
    { cwd: repo, stdio: "inherit", timeout: 180_000 }
  );
  assert.ifError(build.error);
  assert.equal(build.status, 0, `Build failed: ${name}`);
  binaries[name] = { path: outFile, ...collectCliBinaryMetadata(outFile) };
}
// PE subsystem is a property of the actual bytes, not of build arguments.
for (const [role, subsystem] of [
  ["cli", 3],
  ["service", 2],
]) {
  const executable = path.join(
    repo,
    `cli/dist/openmeld-${role}-windows-x64-${version}.exe`
  );
  const bytes = await readFile(executable);
  assert.equal(bytes.toString("ascii", 0, 2), "MZ");
  const pe = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.toString("ascii", pe, pe + 4), "PE\0\0");
  assert.equal(bytes.readUInt16LE(pe + 24 + 68), subsystem);
  binaries[role] = {
    path: executable,
    subsystem,
    ...collectCliBinaryMetadata(executable),
  };
}
await writeFile(
  path.join(evidence, "artifacts.json"),
  JSON.stringify(binaries, null, 2)
);

const root = await mkdtemp(path.join(tmpdir(), "openmeld-native-"));
const workspace = path.join(root, "workspace 中文 with spaces");
await mkdir(workspace);
const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
assert.ok(systemRoot);
// Keep normal Windows OS discovery (including PowerShell's system modules).
// Removing the entire OS environment tests an artificial launcher environment,
// not the promised absence of user-installed Node/Bun. Isolate user state and
// remove developer runtimes from PATH, as the actual Service fixture does.
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path")
  ),
  SystemRoot: systemRoot,
  WINDIR: systemRoot,
  ComSpec: path.join(systemRoot, "System32/cmd.exe"),
  Path: [
    path.join(systemRoot, "System32"),
    path.join(systemRoot, "System32/WindowsPowerShell/v1.0"),
  ].join(";"),
  HOME: root,
  USERPROFILE: root,
  TEMP: root,
  TMP: root,
  APPDATA: path.join(root, "AppData/Roaming"),
  LOCALAPPDATA: path.join(root, "AppData/Local"),
  OPENMELD_HOME: path.join(root, "state"),
  OPENMELD_ENV_PRESET: "dev-local",
  OPENMELD_GATEWAY_URL: "http://127.0.0.1:9",
  OPENMELD_AUTH_URL: "http://127.0.0.1:9",
  CODEX_HOME: path.join(root, "codex-home"),
};
await mkdir(env.CODEX_HOME);
await exerciseManagedLauncher();
await exerciseOwnedComponent({
  executable: binaries["windows-native-runtime"].path,
  args: [binaries["windows-agent-sdk"].path],
  log: "runtime-components.log",
  stages: ["sqlite_readonly", "claude_sdk_native_protocol"],
});
const codex = process.env.OPENMELD_TEST_CODEX;
assert.ok(
  codex && path.isAbsolute(codex),
  "The pinned official Windows Codex artifact is required"
);
await exerciseOwnedComponent({
  executable: binaries["windows-native-codex"].path,
  args: [codex],
  log: "official-codex.log",
  stages: ["official_codex_account_protocol"],
});
await rm(root, { recursive: true, force: true });

async function exerciseManagedLauncher() {
  const installation = path.join(workspace, "managed CLI");
  const bin = path.join(installation, "bin");
  const launcher = path.join(bin, "openmeld.exe");
  await mkdir(bin, { recursive: true });
  for (const installedVersion of ["1.0.0", "1.0.1"]) {
    const directory = path.join(installation, "versions", installedVersion);
    await mkdir(directory, { recursive: true });
    await copyFile(
      binaries["windows-managed-launcher"].path,
      path.join(directory, "openmeld.exe")
    );
  }
  await copyFile(helper, launcher);
  const record = path.join(bin, "cli-installation.json");
  const select = async (selectedVersion) => {
    const next = `${record}.next`;
    await writeFile(
      next,
      JSON.stringify({ schemaVersion: 1, version: selectedVersion })
    );
    await rename(next, record);
  };
  await select("1.0.0");
  const release = path.join(installation, "release-child");
  const args = [
    "",
    "中文 with spaces",
    'literal"quote',
    "tail\\",
    "%PATH%",
    "&()^!|<>;",
  ];
  const owned = spawnAgentControllerProcess({
    bin: launcher,
    args: [release, ...args],
    cwd: workspace,
    env,
    shell: false,
  });
  let output = "";
  let stderr = "";
  let deadline;
  const failures = [];
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        owned.child.once("error", reject);
        owned.child.once("close", () =>
          reject(new Error("Launcher closed before its child was ready"))
        );
        owned.child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        owned.child.stdout.on("data", (chunk) => {
          output += chunk.toString();
          if (output.includes("\n")) {
            resolve();
          }
        });
      }),
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Managed launcher did not become ready")),
          30_000
        );
      }),
    ]);
    clearTimeout(deadline);
    const child = JSON.parse(output.trim());
    assert.deepEqual(child, {
      stage: "launcher_child",
      version: "1.0.0",
      args,
      cwd: workspace,
    });
    // Windows may rename a running image but must never overwrite its bytes.
    // Preserve the old image until its known child exits, then remove it.
    const retired = path.join(bin, "retired-launcher.exe");
    await rename(launcher, retired);
    await copyFile(helper, launcher);
    await select("1.0.1");
    const next = spawnSync(launcher, ["immediate", ...args], {
      cwd: workspace,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.ifError(next.error);
    assert.equal(next.status, 7, next.stderr);
    assert.deepEqual(JSON.parse(next.stdout.trim()), {
      stage: "launcher_child",
      version: "1.0.1",
      args,
      cwd: workspace,
    });
    assert.equal(next.stderr, "launcher child stderr\n");
    const closed = new Promise((resolve) => owned.child.once("close", resolve));
    await writeFile(release, "ready");
    assert.equal(
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("Old launcher did not exit")),
            30_000
          );
        }),
      ]),
      7
    );
    assert.equal(stderr, "launcher child stderr\n");
    await rm(retired);
    console.log(
      JSON.stringify({ stage: "managed_launcher_handoff", status: "passed" })
    );
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(deadline);
    await writeFile(
      path.join(evidence, "managed-launcher.log"),
      output + stderr
    ).catch((error) => failures.push(error));
    owned.terminate("SIGKILL");
    const cleanup = await owned.terminateRemainingDescendants();
    if (!cleanup.ok) {
      failures.push(cleanup.error);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, "Managed launcher acceptance failed");
  }
}

async function exerciseOwnedComponent(input) {
  console.log(
    JSON.stringify({
      stage: "component_launch",
      status: "started",
      executable: input.executable,
      peer: input.args[0],
      cwd: workspace,
    })
  );
  const owned = spawnAgentControllerProcess({
    bin: input.executable,
    args: input.args,
    cwd: workspace,
    env,
    shell: false,
  });
  console.log(
    JSON.stringify({ stage: "component_supervisor", pid: owned.child.pid })
  );
  let output = "";
  owned.child.stdout.on("data", (chunk) => {
    output = (output + chunk.toString()).slice(-1024 * 1024);
  });
  owned.child.stderr.on("data", (chunk) => {
    output = (output + chunk.toString()).slice(-1024 * 1024);
  });
  const failures = [];
  // The SDK retains its own 30-second deadline; the outer budget includes Job
  // setup, SQLite and cleanup. It is functional acceptance, not a startup SLA.
  let deadline;
  try {
    const code = await Promise.race([
      new Promise((resolve, reject) => {
        owned.child.once("close", resolve);
        owned.child.once("error", reject);
      }),
      new Promise((_, reject) => {
        deadline = setTimeout(
          () =>
            reject(
              new Error("Native component acceptance exceeded 45 seconds")
            ),
          45_000
        );
      }),
    ]);
    assert.equal(code, 0, output);
    for (const stage of input.stages) {
      assert.ok(
        output.includes(`"stage":"${stage}","status":"passed"`),
        output
      );
    }
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(deadline);
    try {
      await writeFile(path.join(evidence, input.log), output);
    } catch (error) {
      failures.push(error);
    }
    process.stdout.write(output);
    owned.terminate("SIGKILL");
    const cleanup = await owned.terminateRemainingDescendants();
    if (!cleanup.ok) {
      failures.push(cleanup.error);
    }
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      "Native runtime component acceptance failed"
    );
  }
}
