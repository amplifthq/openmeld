// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone native acceptance entrypoint; failed assertions must exit nonzero.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const binaries = {};
for (const name of ["windows-agent-sdk", "windows-native-runtime"]) {
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

const root = await mkdtemp(path.join(tmpdir(), "OpenMeld native 空格 "));
const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
assert.ok(systemRoot);
const env = {
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
};
const owned = spawnAgentControllerProcess({
  bin: binaries["windows-native-runtime"].path,
  args: [binaries["windows-agent-sdk"].path],
  cwd: root,
  env,
  shell: false,
});
let output = "";
owned.child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
owned.child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});
const failures = [];
// The SDK retains its own 30-second deadline; the outer budget includes Job
// setup, SQLite and cleanup. It is functional acceptance, not a startup SLA.
let deadline;
try {
  const code = await Promise.race([
    new Promise((resolve, reject) => {
      owned.child.once("exit", resolve);
      owned.child.once("error", reject);
    }),
    new Promise((_, reject) => {
      deadline = setTimeout(
        () =>
          reject(new Error("Native component acceptance exceeded 45 seconds")),
        45_000
      );
    }),
  ]);
  assert.equal(code, 0, output);
  assert.ok(
    output.includes('"stage":"sqlite_readonly","status":"passed"'),
    output
  );
  assert.ok(
    output.includes('"stage":"claude_sdk_native_protocol","status":"passed"'),
    output
  );
} catch (error) {
  failures.push(error);
} finally {
  clearTimeout(deadline);
  await writeFile(path.join(evidence, "runtime-components.log"), output);
  process.stdout.write(output);
  owned.terminate("SIGKILL");
  const cleanup = await owned.terminateRemainingDescendants();
  if (cleanup.ok) {
    await rm(root, { recursive: true, force: true });
  } else {
    failures.push(cleanup.error);
  }
}
if (failures.length) {
  throw new AggregateError(
    failures,
    "Native runtime component acceptance failed"
  );
}
