import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { spawnAgentControllerProcess } from "../dist/agent-controller-process.js";
import { WINDOWS_PROCESS_JOB_SCRIPT } from "../dist/windows-process-job.js";
import { powerShellEncodedArguments } from "../dist/windows-system.js";

const native = { skip: process.platform !== "win32", timeout: 60_000 };
const treeScript = `
const {spawn}=require('node:child_process');
const grandchildCode="console.log(JSON.stringify({grandchild:process.pid}));setInterval(()=>{},1000)";
const childCode="const {spawn}=require('node:child_process');const grand=spawn(process.execPath,['-e',"+JSON.stringify(grandchildCode)+"],{stdio:['ignore','pipe','inherit']});grand.stdout.pipe(process.stdout);console.log(JSON.stringify({child:process.pid}));setInterval(()=>{},1000)";
const child=spawn(process.execPath,['-e',childCode],{stdio:['ignore','pipe','inherit']});
child.stdout.pipe(process.stdout);
console.log(JSON.stringify({controller:process.pid}));
process.stdin.on('data',()=>process.exit(0));
setInterval(()=>{},1000);
`;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitFor(check, message) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(50);
  }
  throw new Error(message);
}

function start(args, cwd = process.cwd()) {
  const runtime = spawnAgentControllerProcess({
    bin: process.execPath,
    args,
    cwd,
    env: process.env,
    shell: false,
  });
  const stdout = [];
  const stderr = [];
  runtime.child.stdout.setEncoding("utf8");
  runtime.child.stderr.setEncoding("utf8");
  runtime.child.stdout.on("data", (chunk) => stdout.push(chunk));
  runtime.child.stderr.on("data", (chunk) => stderr.push(chunk));
  const closed = once(runtime.child, "close");
  return {
    runtime,
    closed,
    output: () => stdout.join(""),
    errors: () => stderr.join(""),
  };
}

async function readTree(process) {
  let pids = {};
  await waitFor(() => {
    pids = Object.assign(
      {},
      ...process
        .output()
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return {};
          }
        })
    );
    return pids.controller && pids.child && pids.grandchild;
  }, `Windows process tree did not start: ${process.errors()}`);
  return Object.values(pids);
}

test("the fixed native launcher fits Windows' CreateProcess command-line limit", () => {
  assert(
    powerShellEncodedArguments(WINDOWS_PROCESS_JOB_SCRIPT).join(" ").length <
      30_000
  );
});

test(
  "native Windows Job preserves raw streams, Unicode argv and working directory, and provider exit status",
  native,
  async () => {
    const args = ['a"b', "中文 & %PATH%", "one\ntwo", ""];
    const cwd = await mkdtemp(join(tmpdir(), "OpenMeld native 空格 "));
    const child = start(
      [
        "-e",
        "process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd()}));process.stderr.write('native-diagnostic');process.exitCode=7})",
        ...args,
      ],
      cwd
    );
    try {
      child.runtime.child.stdin.end("raw input");
      const [code] = await child.closed;
      assert.equal(code, 7, child.errors());
      assert.deepEqual(JSON.parse(child.output()), { args, cwd });
      assert.equal(child.errors(), "native-diagnostic");
    } finally {
      assert.equal(
        (await child.runtime.terminateRemainingDescendants()).ok,
        true
      );
      await rm(cwd, { recursive: true, force: true });
    }
  }
);

test(
  "native Windows cancellation drains child/grandchild without affecting another invocation",
  native,
  async () => {
    const first = start(["-e", treeScript]);
    const other = start([
      "-e",
      "console.log(process.pid);setInterval(()=>{},1000)",
    ]);
    try {
      const pids = await readTree(first);
      await waitFor(() => Boolean(other.output().trim()), other.errors());
      const otherPid = Number(other.output().trim());
      assert(pids.every(alive));
      first.runtime.terminate("SIGTERM");
      const cleanup = await first.runtime.terminateRemainingDescendants();
      assert.equal(cleanup.ok, true, String(cleanup.error ?? ""));
      assert(pids.every((pid) => !alive(pid)));
      assert.equal(alive(otherPid), true);
    } finally {
      await first.runtime.terminateRemainingDescendants();
      await other.runtime.terminateRemainingDescendants();
    }
  }
);

test(
  "native Windows controller exit cleans descendants before reporting completion",
  native,
  async () => {
    const child = start(["-e", treeScript]);
    try {
      const pids = await readTree(child);
      child.runtime.child.stdin.write("exit");
      const [code] = await child.closed;
      assert.equal(code, 0, child.errors());
      assert(pids.every((pid) => !alive(pid)));
    } finally {
      assert.equal(
        (await child.runtime.terminateRemainingDescendants()).ok,
        true
      );
    }
  }
);

test(
  "native Windows launch-owner death terminates its controller and descendants",
  native,
  async () => {
    const root = await mkdtemp(join(tmpdir(), "OpenMeld owner-death "));
    const report = join(root, "tree.jsonl");
    // Resolve relative to this test, so the case also works from the repository root.
    const actualModule = new URL(
      "../dist/agent-controller-process.js",
      import.meta.url
    ).href;
    const ownerSource = `import {spawnAgentControllerProcess} from ${JSON.stringify(actualModule)};import {appendFileSync} from 'node:fs';const p=spawnAgentControllerProcess({bin:process.execPath,args:['-e',${JSON.stringify(treeScript)}],cwd:process.cwd(),env:process.env,shell:false});let output='';p.child.stdout.on('data',b=>{const s=b.toString();appendFileSync(${JSON.stringify(report)},s);output+=s;if(output.includes('grandchild')&&output.includes('"child"')&&output.includes('controller'))process.exit(0)});p.child.stderr.pipe(process.stderr);`;
    const owner = spawn(
      process.execPath,
      ["--input-type=module", "-e", ownerSource],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
    );
    let errors = "";
    owner.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    try {
      const [code] = await once(owner, "exit", {
        signal: AbortSignal.timeout(25_000),
      });
      assert.equal(code, 0, errors);
      const records = (await readFile(report, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const pids = Object.values(Object.assign({}, ...records));
      assert.equal(pids.length, 3);
      await waitFor(
        () => pids.every((pid) => !alive(pid)),
        "Owned descendants remained after the caller exited"
      );
    } finally {
      owner.kill();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  "native Windows cancellation before controller creation cannot orphan a late launch",
  native,
  async () => {
    const root = await mkdtemp(join(tmpdir(), "OpenMeld cancel-launch "));
    const marker = join(root, "started.txt");
    const child = start([
      "-e",
      `require('fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`,
    ]);
    try {
      child.runtime.terminate("SIGKILL");
      assert.equal(
        (await child.runtime.terminateRemainingDescendants()).ok,
        true
      );
      const afterCleanup = await readFile(marker, "utf8").catch(() => null);
      if (afterCleanup) {
        assert.equal(alive(Number(afterCleanup)), false);
      }
      await delay(500);
      assert.equal(
        await readFile(marker, "utf8").catch(() => null),
        afterCleanup
      );
    } finally {
      await child.runtime.terminateRemainingDescendants();
      await rm(root, { recursive: true, force: true });
    }
  }
);
