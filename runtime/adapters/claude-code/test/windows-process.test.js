import assert from "node:assert/strict";
import test from "node:test";
import { createClaudeWindowsProcessLauncher } from "../dist/transport/claude-windows-process.js";

const CHANGED_EXECUTABLE_ERROR = /changed the selected/;
const noStderr = () => undefined;

test("the SDK spawn contract preserves the pinned runtime, prefixes, stderr and input streams", async () => {
  const launcher = createClaudeWindowsProcessLauncher({
    bin: process.execPath,
    argsPrefix: [
      "-e",
      "process.stdin.resume(); process.stdin.on('end',()=>{console.error('诊断'); process.stdout.write(JSON.stringify(process.argv.slice(1)))})",
    ],
  });
  const forwarded = new AbortController();
  const args = ['quote"', "%PATH% & text", "line1\nline2", "中文"];
  let stderr = "";
  try {
    const child = launcher.spawn(
      {
        command: process.execPath,
        args,
        cwd: process.cwd(),
        env: process.env,
        signal: forwarded.signal,
      },
      (chunk) => {
        stderr += chunk;
      }
    );
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const exited = new Promise((resolve, reject) => {
      child.on("exit", resolve);
      child.on("error", reject);
    });
    const outputEnded = new Promise((resolve) =>
      child.stdout.on("end", resolve)
    );
    child.stdin.end();
    assert.equal(await exited, 0);
    await outputEnded;
    assert.deepEqual(JSON.parse(stdout), args);
    assert.equal(stderr.includes("诊断"), true);
  } finally {
    await launcher.cleanup();
  }
});

test("the SDK cannot retarget an executable or start an already-cancelled invocation", async () => {
  const launcher = createClaudeWindowsProcessLauncher({
    bin: process.execPath,
    argsPrefix: [],
  });
  const controller = new AbortController();
  const options = {
    command: "another.exe",
    args: [],
    env: {},
    signal: controller.signal,
  };
  assert.throws(
    () => launcher.spawn(options, noStderr),
    CHANGED_EXECUTABLE_ERROR
  );
  controller.abort();
  assert.throws(
    () => launcher.spawn({ ...options, command: process.execPath }, noStderr),
    { name: "AbortError" }
  );
  await launcher.cleanup();
});
