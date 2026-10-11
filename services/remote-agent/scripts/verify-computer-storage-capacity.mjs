import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const oomPattern = /^oom_kill [1-9]/m;
const image = process.argv[2];
const mode = process.argv[3] ?? "retain";
const outputPath = resolve(
  process.argv[4] ??
    `dev-tmp/computer-bounded/storage-capacity-${mode}.result.json`
);
assert(["retain", "churn"].includes(mode));
assert(/^cloudflare-dev\/computercontainerprobe:[a-f0-9]+$/.test(image));
const name = `openmeld-capacity-${randomUUID().slice(0, 8)}`;
const memory = 6 * 1024 ** 3;
const report = {
  harnessSha256: createHash("sha256")
    .update(await readFile(new URL(import.meta.url)))
    .digest("hex"),
  name,
  image,
  mode,
  memoryBytes: memory,
  vcpu: 1,
  swapBytes: 0,
  maxWriteBytes: 8 * 1024 ** 3,
  samples: [],
  writes: [],
  scope:
    "Isolated native FUSE storage capacity, not synchronization or production deployment",
};
const docker = async (...args) =>
  (await exec("docker", args, { timeout: 10_000, maxBuffer: 2_000_000 }))
    .stdout;
const waitForMount = async (id) => {
  for (let i = 0; ; i++) {
    const mounts = await docker("exec", id, "cat", "/proc/mounts");
    if (mounts.includes(" /computer fuse ")) {
      return;
    }
    assert(i < 100, "Real FUSE mount did not start");
    await new Promise((done) => setTimeout(done, 100));
  }
};
let id;
let timer;
let pending = Promise.resolve();
let busy = false;
let deadline;
try {
  id = (
    await docker(
      "run",
      "--detach",
      "--pull",
      "never",
      "--name",
      name,
      "--network",
      "none",
      "--cpus",
      "1",
      "--memory",
      String(memory),
      "--memory-swap",
      String(memory),
      "--cap-add",
      "SYS_ADMIN",
      "--device",
      "/dev/fuse",
      "--security-opt",
      "apparmor:unconfined",
      "--env",
      "MOUNT_POINT=/computer",
      "--env",
      "FUSE_MOUNT=fuse",
      "--env",
      "COMPUTERD_FUSE_ATTR_TIMEOUT=0",
      "--env",
      "COMPUTERD_FUSE_AUTO_CACHE=0",
      image
    )
  ).trim();
  report.id = id;
  const inspect = JSON.parse(await docker("inspect", id))[0];
  assert(inspect.HostConfig.Memory === memory);
  assert(inspect.HostConfig.MemorySwap === memory);
  assert(inspect.HostConfig.NanoCpus === 1_000_000_000);
  await waitForMount(id);
  report.source = JSON.parse(
    await docker(
      "exec",
      id,
      "cat",
      "/usr/local/share/openmeld/computerd-source.json"
    )
  );
  report.startLog = await docker("logs", id);
  assert(
    report.startLog.includes("store=file"),
    "Expected candidate file-backed storage"
  );
  const sample = async () => {
    const raw = await docker(
      "exec",
      id,
      "python3",
      "-c",
      "import pathlib,json; data={k:(pathlib.Path('/sys/fs/cgroup')/k).read_text().strip() for k in ['memory.current','memory.peak','memory.events','memory.stat','memory.max','memory.swap.max','cpu.max','cpu.stat']}; data['storageFiles']={str(p):p.stat().st_size for p in pathlib.Path('/var/lib/computerd').glob('*') if p.is_file()}; print(json.dumps(data))"
    );
    const data = JSON.parse(raw);
    assert(data["memory.max"] === String(memory));
    assert(data["memory.swap.max"] === "0");
    const [quota, period] = data["cpu.max"].split(" ").map(Number);
    assert(quota > 0 && quota === period);
    report.samples.push({ at: new Date().toISOString(), ...data });
  };
  await sample();
  timer = setInterval(() => {
    if (busy) {
      return;
    }
    busy = true;
    pending = sample()
      .catch((error) => {
        report.lastSamplingError = String(error);
      })
      .finally(() => {
        busy = false;
      });
  }, 1000);
  const writer = spawn(
    "docker",
    [
      "exec",
      id,
      "python3",
      "-u",
      "-c",
      `import pathlib,os,json,hashlib,time,errno,shutil
p=pathlib.Path("/computer/capacity"); p.mkdir()
expected={}; full=False
for i in range(512):
 if i>0 and ${mode === "churn" ? "True" : "False"}:
  (p/str(i-1)).unlink(); del expected[str(i-1)]
 b=os.urandom(16*1024*1024); path=p/str(i)
 try:
  with path.open("wb") as f: f.write(b)
 except OSError as e:
  if e.errno!=errno.ENOSPC: raise
  full=True; print(json.dumps({"capacityRejected":True,"errno":e.errno}),flush=True); break
 digest=hashlib.sha256(b).hexdigest()
 assert hashlib.sha256(path.read_bytes()).hexdigest()==digest
 expected[str(i)]=digest
 print(json.dumps({"files":i+1,"bytes":(i+1)*len(b),"liveFiles":len(list(p.iterdir())),"sha256":digest}),flush=True)
assert full==${mode === "retain" ? "True" : "False"}
if full: assert len(expected)*16*1024*1024 >= 3*1024**3, "Capacity refusal occurred before 3 GiB of successful files"
for name,digest in expected.items(): assert hashlib.sha256((p/name).read_bytes()).hexdigest()==digest
print(json.dumps({"verifiedFiles":len(expected),"verifiedBeforeDeletion":True}),flush=True)
shutil.rmtree(p)
for attempt in range(300):
 try:
  p.mkdir(exist_ok=True); b=os.urandom(16*1024*1024); (p/"after-gc").write_bytes(b)
  assert (p/"after-gc").read_bytes()==b; break
 except OSError as e:
  if e.errno!=errno.ENOSPC or attempt==299: raise
  time.sleep(.1)
print(json.dumps({"done":True,"reusedAfterRecursiveDelete":True,"restartSha256":hashlib.sha256(b).hexdigest(),"statvfsAvailableBytes":os.statvfs(p).f_bavail*os.statvfs(p).f_frsize}),flush=True)`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let output = "";
  let errors = "";
  writer.stdout.on("data", (chunk) => {
    output += chunk.toString();
    for (;;) {
      const end = output.indexOf("\n");
      if (end < 0) {
        break;
      }
      const line = output.slice(0, end);
      output = output.slice(end + 1);
      const item = JSON.parse(line);
      report.writes.push(item);
      if (item.files % 32 === 0 || item.done) {
        console.log(JSON.stringify(item));
      }
    }
  });
  writer.stderr.on("data", (chunk) => {
    errors += chunk.toString();
  });
  deadline = setTimeout(() => {
    report.timedOut = true;
    docker("kill", id).catch((error) => {
      report.deadlineKillError = String(error);
    });
  }, 900_000);
  report.writerExit = await new Promise((resolve) =>
    writer.once("close", (code, signal) => resolve({ code, signal }))
  );
  clearTimeout(deadline);
  clearInterval(timer);
  await pending;
  report.stderr = errors;
  report.finalState = JSON.parse(await docker("inspect", id))[0].State;
  if (report.finalState.Running) {
    await sample();
  }
  report.oomKilled =
    report.finalState.OOMKilled ||
    report.samples.some((s) => oomPattern.test(s["memory.events"]));
  report.peakMemory = Math.max(
    ...report.samples.map((s) => Number(s["memory.peak"]))
  );
  report.peakSampledStorageBytes = Math.max(
    ...report.samples.map((s) =>
      Object.values(s.storageFiles).reduce((total, size) => total + size, 0)
    )
  );
  report.outcome = "writer_failed";
  if (report.writes.at(-1)?.done) {
    report.outcome = "write_budget_completed";
  }
  if (report.lastSamplingError) {
    report.outcome = "incomplete_sampling";
  }
  if (report.timedOut) {
    report.outcome = "incomplete_timeout";
  }
  if (report.oomKilled) {
    report.outcome = "oom_observed";
  }
  assert(
    report.writerExit.code === 0 && report.writerExit.signal === null,
    errors || JSON.stringify(report.writerExit)
  );
  assert(
    report.outcome === "write_budget_completed",
    JSON.stringify(report.writerExit)
  );
  report.storageFiles = JSON.parse(
    await docker(
      "exec",
      id,
      "python3",
      "-c",
      "import pathlib,json; print(json.dumps({str(p):p.stat().st_size for p in pathlib.Path('/var/lib/computerd').glob('*') if p.is_file()}))"
    )
  );
  report.restartMethod = "SIGKILL followed by start of the same container";
  await docker("kill", "--signal", "KILL", id);
  await docker("start", id);
  await waitForMount(id);
  const restoredHash = (
    await docker(
      "exec",
      id,
      "python3",
      "-c",
      "import pathlib,hashlib; print(hashlib.sha256(pathlib.Path('/computer/capacity/after-gc').read_bytes()).hexdigest())"
    )
  ).trim();
  assert(restoredHash === report.writes.at(-1).restartSha256);
  report.processRestartVerified = true;
  await sample();
  report.restartState = JSON.parse(await docker("inspect", id))[0].State;
  report.oomKilled ||=
    report.restartState.OOMKilled ||
    report.samples.some((s) => oomPattern.test(s["memory.events"]));
  report.peakMemory = Math.max(
    ...report.samples.map((s) => Number(s["memory.peak"]))
  );
  assert(!report.oomKilled, "OOM observed before or after process restart");
} catch (error) {
  report.error = String(error);
  report.outcome = "incomplete_error";
} finally {
  clearTimeout(deadline);
  clearInterval(timer);
  await pending;
  if (id) {
    await docker("rm", "--force", id).catch((error) => {
      report.cleanupError = String(error);
    });
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(
  JSON.stringify({
    outcome: report.outcome,
    peakMemory: report.peakMemory,
    lastWrite: report.writes.at(-1),
    error: report.error,
  })
);
if (
  report.outcome !== "write_budget_completed" ||
  !report.processRestartVerified ||
  report.cleanupError
) {
  process.exitCode = 1;
}
