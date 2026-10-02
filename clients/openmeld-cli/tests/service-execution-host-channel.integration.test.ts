import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionHostClient } from "../src/local-service/execution-host/channel";
import { childExecutionHostChannel } from "../src/local-service/execution-host/process-channel";

const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const loader = join(
  vitestRequire.resolve("tsx/package.json"),
  "..",
  "dist",
  "loader.mjs"
);
const fixture = join(
  import.meta.dirname,
  "fixtures",
  "service-execution-host-channel.ts"
);
const cleanup: Array<() => Promise<void>> = [];

function startFixture(mode = "normal") {
  const hostInstanceId = randomUUID();
  const child = spawn(
    process.execPath,
    ["--import", loader, fixture, hostInstanceId, mode],
    {
      env: { ...process.env },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "json",
    }
  );
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4096);
  });
  const started = Promise.withResolvers<void>();
  const client = createExecutionHostClient({
    channel: childExecutionHostChannel(child),
    hostInstanceId,
    onEvent: () => {
      started.resolve();
    },
  });
  cleanup.push(async () => {
    client.dispose();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await exited;
  });
  return { child, client, started: started.promise, stderr: () => stderr };
}

afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanup.splice(0).reverse()) {
    await close();
  }
});

describe("execution host inherited IPC", () => {
  it("carries one exact input and immutable source through inherited IPC without another native send", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "openmeld-input-ipc-"));
    vi.stubEnv("OPENMELD_HOME", stateRoot);
    cleanup.push(() => rm(stateRoot, { recursive: true, force: true }));
    const { client } = startFixture();
    const request = {
      inputId: "input-1",
      ownerUserId: "owner-1",
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: "execution-1",
      targetProfileId: "agent-1",
      source: {
        spaceId: "space-1",
        signalId: "signal-1",
        authorProfileId: "author-1",
        requesterUserId: "requester-1",
        effect: "steer" as const,
      },
      text: "Use the revised requirement.",
    };
    const payload = {
      operation: "apply" as const,
      connectionGeneration: 1,
      leaseEpoch: 1,
      request,
    };
    const receipt = await client.call("executionInput", payload);
    expect(receipt).toMatchObject({
      status: "applied",
      inputId: "input-1",
      taskId: "task-1",
      turnId: "turn-1",
    });
    expect(await client.call("executionInput", payload)).toEqual(receipt);
    expect(
      await client.call("executionInput", { ...payload, operation: "read" })
    ).toEqual(receipt);
    expect(
      await client.call("executionInput", {
        ...payload,
        request: {
          ...request,
          source: { ...request.source, requesterUserId: "another-requester" },
        },
      })
    ).toEqual({ inputId: "input-1", status: "conflict" });
    expect(
      await client.call("executionInput", {
        ...payload,
        request: { ...request, inputId: "input-2" },
      })
    ).toMatchObject({ turnId: "turn-2" });
  });

  it("keeps local control responsive during a real Host event-loop stall", async () => {
    const { child, client, started } = startFixture("stall");
    const health = await client.call("health", {});
    expect(health.pid).toBe(child.pid);
    const server = createServer((_request, response) => {
      response.end("connector available");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an isolated loopback fixture.");
    }
    const stuck = client.call(
      "loadCatalog",
      { initial: true },
      { timeoutMs: null }
    );
    // Attach rejection handling before fault cleanup closes the process.
    const stuckOutcome = stuck.catch((error: unknown) => error);
    await started;
    vi.useFakeTimers();
    const probe = client.call("health", {}, { timeoutMs: 50 });
    const refused = expect(probe).rejects.toMatchObject({
      code: "host.observation_timeout",
    });
    await vi.advanceTimersByTimeAsync(51);
    await refused;
    vi.useRealTimers();
    expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe(
      "connector available"
    );
    expect(child.killed).toBe(false);
    client.dispose();
    expect(await stuckOutcome).toMatchObject({ code: "host.observer_closed" });
  });

  it("does not cancel accepted work, replay it, or retire a long drain when an observer times out", async () => {
    const { child, client, started } = startFixture();
    await client.call("health", {});
    vi.useFakeTimers();
    const work = client.call(
      "reportControllers",
      { probePolicy: "background" },
      { timeoutMs: 50 }
    );
    const timedOut = expect(work).rejects.toMatchObject({
      code: "host.observation_timeout",
    });
    await started;
    await vi.advanceTimersByTimeAsync(51);
    await timedOut;
    const drain = client.call("drain", {}, { timeoutMs: null });
    await vi.advanceTimersByTimeAsync(600_000);
    vi.useRealTimers();
    expect(await client.call("health", {})).toMatchObject({
      pid: child.pid,
      activeCount: 1,
    });
    await client.call("syncActivity", {});
    expect(await drain).toMatchObject({ pid: child.pid, activeCount: 0 });
    expect(await client.call("health", {})).toMatchObject({ activeCount: 0 });
    expect(client.pendingCount()).toBe(0);
    expect(child.killed).toBe(false);
  });

  it("reports a crashed Host without automatically creating a replacement process", async () => {
    const { child, client } = startFixture("crash");
    const health = await client.call("health", {});
    expect(health.pid).toBe(child.pid);
    await expect(
      client.call("loadCatalog", { initial: true })
    ).rejects.toMatchObject({ code: "host.disconnected" });
    await expect(client.call("health", {})).rejects.toMatchObject({
      code: "host.disconnected",
    });
    expect(client.pendingCount()).toBe(0);
  });
});
