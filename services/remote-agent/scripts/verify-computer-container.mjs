import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Run through the repository's resource guard. Docker is required; this is an
// isolated native check, not a deployment or a production CPU-limit certificate.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const mode = process.argv[2] ?? "matrix";
const profile = process.argv[3] ?? "candidate";
const workerName = `openmeld-container-check-${randomUUID().slice(0, 8)}`;
const execFileAsync = promisify(execFile);
assert(
  ["matrix", "adoption", "pack"].includes(mode),
  "Use matrix, adoption or pack"
);
assert(
  ["candidate", "default", "ac-only", "attr-ac"].includes(profile),
  "Unknown native cache profile"
);
assert(
  mode !== "adoption" || profile === "candidate",
  "Adoption checks the actual candidate configuration"
);
const requireRemote = createRequire(
  join(repoRoot, "services/remote-agent/package.json")
);
const requireWrangler = createRequire(requireRemote.resolve("wrangler"));
const { build } = requireWrangler("esbuild");
const stateRoot = await mkdtemp(join(tmpdir(), "openmeld-container-state-"));
const artifactRoot = await mkdtemp(
  join(tmpdir(), "openmeld-container-evidence-")
);
const sourcePaths = [
  "services/remote-agent/flue-adapter/computer-workspace.ts",
  "services/remote-agent/flue-adapter/computer-workspace-config.ts",
  "services/remote-agent/flue-adapter/computer-command.ts",
  "services/remote-agent/tests/fixtures/computer-container.ts",
  "services/remote-agent/scripts/verify-computer-container.mjs",
  "services/remote-agent/Dockerfile",
  "services/remote-agent/computerd/upstream.patch",
  "services/remote-agent/computerd/build.mjs",
  "patches/@cloudflare__computer@0.4.1.patch",
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(join(repoRoot, path)))
        .digest("hex"),
    ])
  )
);
const reserve = createServer();
await new Promise((done) => reserve.listen(0, "127.0.0.1", done));
const port = reserve.address().port;
await new Promise((done) => reserve.close(done));
const built = await build({
  entryPoints: [
    join(
      repoRoot,
      "services/remote-agent/tests/fixtures/computer-container.ts"
    ),
  ],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
  platform: "neutral",
  mainFields: ["module", "main"],
  nodePaths: [join(repoRoot, "services/remote-agent/node_modules")],
  external: ["cloudflare:*", "node:*"],
});
await writeFile(join(stateRoot, "worker.js"), built.outputFiles[0].text);
await writeFile(
  join(stateRoot, "wrangler.json"),
  JSON.stringify(
    {
      name: workerName,
      main: "worker.js",
      compatibility_date: "2026-07-15",
      compatibility_flags: ["nodejs_compat"],
      vars: { FUSE_PROFILE: profile },
      containers: [
        {
          class_name: "ComputerContainerProbe",
          image: join(repoRoot, "services/remote-agent/Dockerfile"),
          max_instances: 1,
          instance_type: "standard-2",
        },
      ],
      durable_objects: {
        bindings: [{ name: "PROBE", class_name: "ComputerContainerProbe" }],
      },
      migrations: [
        { tag: "v1", new_sqlite_classes: ["ComputerContainerProbe"] },
      ],
    },
    null,
    2
  )
);
const child = spawn(
  process.execPath,
  [
    join(
      dirname(requireRemote.resolve("wrangler/package.json")),
      "bin/wrangler.js"
    ),
    "dev",
    "--config",
    join(stateRoot, "wrangler.json"),
    "--port",
    String(port),
    "--inspector-port",
    "0",
    "--persist-to",
    join(stateRoot, "state"),
  ],
  {
    cwd: repoRoot,
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  }
);
const shutdown = new AbortController();
const abort = () => shutdown.abort(new Error("Native check interrupted"));
process.once("SIGINT", abort);
process.once("SIGTERM", abort);
const workerLog = join(artifactRoot, "worker.log");
const liveLog = createWriteStream(workerLog);
let log = "";
let exited = false;
const exitPromise = new Promise((done) =>
  child.once("close", (code) => {
    exited = true;
    done(code);
  })
);
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (part) => {
    log += part.toString();
    liveLog.write(part);
  });
}
const startedAt = Date.now();
console.log(JSON.stringify({ mode, profile, artifactRoot, workerLog }));
let failure;
try {
  while (
    !(
      log.includes(`Ready on http://localhost:${port}`) ||
      log.includes(`Ready on http://127.0.0.1:${port}`)
    )
  ) {
    shutdown.signal.throwIfAborted();
    assert(!exited, `Native Worker exited before startup: ${log.slice(-1500)}`);
    assert(
      Date.now() - startedAt < 600_000,
      `Native source build/startup exceeded 600 seconds: ${log.slice(-1500)}`
    );
    await new Promise((done) => setTimeout(done, 500));
  }
  const response = await fetch(
    `http://127.0.0.1:${port}/${mode === "pack" ? "run" : mode}`,
    { signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(360_000)]) }
  );
  const body = await response.text();
  assert(response.status === 200, body.slice(0, 2000));
  const data = JSON.parse(body);
  const reportPath = join(artifactRoot, "report.json");
  await writeFile(
    reportPath,
    `${JSON.stringify({ mode, profile, sourceHashes, compatibilityDate: "2026-07-15", elapsedMs: Date.now() - startedAt, ...data }, null, 2)}\n`
  );
  let summary;
  const finalMount = mode === "adoption" ? data.afterMount : data.mount;
  assert(
    finalMount.source.sourcePatchSha256 ===
      sourceHashes["services/remote-agent/computerd/upstream.patch"],
    "Native image was built from a different source patch"
  );
  if (mode === "matrix") {
    summary = { records: data.records, cost: data.cost, mount: data.mount };
  } else if (mode === "adoption") {
    summary = {
      beforeRuntimeId: data.beforeRuntimeId,
      afterRuntimeId: data.afterRuntimeId,
      originalExecCounts: data.originalExecCounts,
      loss: data.loss,
    };
  } else {
    summary = {
      leaves: data.leaves,
      packCalls: data.records.length,
      replayApplied: data.records[1]?.applied,
      reset: data.reset,
    };
  }
  console.log(
    JSON.stringify({
      reportPath,
      elapsedMs: Date.now() - startedAt,
      ...summary,
    })
  );
  if (mode === "matrix") {
    assert(
      data.records.every((record) => record.passed),
      "Native mutation matrix failed"
    );
  } else if (mode === "adoption") {
    assert(
      data.originalExecCounts.completed === 1,
      "Completed command was relaunched"
    );
    assert(
      data.originalExecCounts.pending === 1,
      "Pending command was relaunched"
    );
  } else {
    assert(data.leaves === 20_200, "Native paths were lost");
    assert(data.records[0].lost === true, "No actual acknowledgement was lost");
    assert(data.records[1].applied === 0, "Replay applied duplicate changes");
  }
} catch (error) {
  failure = error;
} finally {
  if (!exited) {
    child.kill("SIGINT");
  }
  const terminated = await Promise.race([
    exitPromise,
    new Promise((done) => {
      const timer = setTimeout(() => done("timeout"), 15_000);
      timer.unref();
    }),
  ]);
  await new Promise((done) => liveLog.end(done));
  process.off("SIGINT", abort);
  process.off("SIGTERM", abort);
  if (terminated === "timeout") {
    failure = new AggregateError(
      [
        ...(failure ? [failure] : []),
        new Error(`Owned native Worker did not stop; preserve ${stateRoot}`),
      ],
      "Native check could not release its owned Worker"
    );
  } else {
    try {
      // Wrangler stops the native instance, but its per-instance proxy can
      // outlive dev shutdown. Remove only this run's unique Docker resources,
      // after its Worker has closed. Reports remain outside stateRoot.
      const { stdout } = await execFileAsync(
        "docker",
        ["ps", "-a", "--format", "{{json .}}"],
        { timeout: 15_000 }
      );
      for (const line of stdout.split("\n").filter(Boolean)) {
        const container = JSON.parse(line);
        if (
          container.Names.startsWith(
            `workerd-${workerName}-ComputerContainerProbe-`
          )
        ) {
          await execFileAsync("docker", ["rm", "--force", container.ID], {
            timeout: 15_000,
          });
        }
      }
      await rm(stateRoot, { recursive: true, force: true });
    } catch (error) {
      failure = new AggregateError(
        [...(failure ? [failure] : []), error],
        `Native check cleanup failed; preserve ${stateRoot}`
      );
    }
  }
}
if (failure) {
  throw failure;
}
