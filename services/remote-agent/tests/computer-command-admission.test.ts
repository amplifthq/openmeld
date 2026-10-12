import { getWorkspace } from "@cloudflare/computer";
import { afterEach, expect, it } from "vitest";
import {
  createCommandAdmissionFixture,
  transportFailure,
} from "./fixtures/computer-command-admission";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});
const fixture = () =>
  createCommandAdmissionFixture((cleanup) => {
    cleanups.push(cleanup);
  });

it("resumes preparation after transport failure and owner restart without claiming or losing files", async () => {
  const f = fixture();
  await f.owner.fs.mkdir("/computer", { recursive: true });
  await f.owner.fs.writeFile("/computer/input.txt", "retained input");
  f.preparationFails(true);
  await expect(f.start()).rejects.toThrow();
  const accepted = await f.record();
  expect(accepted.launchRequestedAt).toBeUndefined();
  expect(f.counts().spawns).toBe(0);
  await f.restart();
  f.preparationFails(false);
  expect(await f.runUntil(() => f.counts().spawns === 1)).toBe(true);
  expect((await f.record()).id).toBe(accepted.id);
  expect(await f.owner.fs.readFile("/computer/input.txt", "utf8")).toBe(
    "retained input"
  );
  expect(f.files.has("/computer/input.txt")).toBe(true);
  await f.poll();
  expect(f.counts().spawns).toBe(1);
});

it("does not retry admission when its durable callback result is uncertain", async () => {
  const f = fixture();
  let admissions = 0;
  for (let step = 0; step < 10 && admissions === 0; step++) {
    try {
      await f.owner.runtime.execWithAdmission(
        "exit 17",
        { id: "uncertain-admission" },
        () => {
          admissions++;
          return Promise.reject(transportFailure());
        }
      );
    } catch {
      /* Bounded preparation yields before the admission fault. */
    }
  }
  expect(admissions).toBe(1);
  expect(f.counts().spawns).toBe(0);
});

it("rechecks file changes made during admission before native dispatch", async () => {
  const f = fixture();
  let admissions = 0;
  let rejected = false;
  for (let step = 0; step < 10 && admissions === 0; step++) {
    try {
      await f.owner.runtime.execWithAdmission(
        "exit 17",
        { id: "changed-input" },
        async () => {
          admissions++;
          await f.owner.fs.writeFile("/new-input.txt", "new input");
        }
      );
    } catch (error) {
      rejected =
        error instanceof Error && error.message.startsWith("ESYNC_PENDING:");
    }
  }
  expect(admissions).toBe(1);
  expect(rejected).toBe(true);
  expect(f.counts().spawns).toBe(0);
  expect(await f.owner.fs.readFile("/new-input.txt", "utf8")).toBe("new input");
});

it("never replays a native launch whose acknowledgement was lost, including after restart", async () => {
  const f = fixture();
  f.launchAckLost();
  try {
    await f.start();
  } catch {
    /* Dispatch may need preparation first. */
  }
  for (let i = 0; i < 10 && f.counts().spawns === 0; i++) {
    try {
      await f.poll();
    } catch {
      /* lost ACK */
    }
  }
  const launched = await f.record();
  expect(f.counts().spawns).toBe(1);
  expect(launched.launchRequestedAt).toEqual(expect.any(Number));
  await f.restart();
  await f.poll();
  expect((await f.record()).id).toBe(launched.id);
  expect(f.counts().spawns).toBe(1);
});

it("resumes the same identity after an explicit native pre-dispatch refusal", async () => {
  const f = fixture();
  f.refuseLaunch(true);
  await f.start();
  for (let i = 0; i < 5; i++) {
    await f.poll();
  }
  const rejected = await f.record();
  expect(rejected.launchRequestedAt).toBeUndefined();
  expect(f.counts().spawns).toBe(0);
  f.refuseLaunch(false);
  expect(await f.runUntil(() => f.counts().spawns === 1)).toBe(true);
  expect((await f.record()).id).toBe(rejected.id);
});

it("rejects admission on a remote client before calling its runtime or callback", async () => {
  const f = fixture();
  using client = await getWorkspace({
    __getWorkspaceStub: async () => f.owner.stub(),
  });
  let admissions = 0;
  expect(() =>
    client.runtime.execWithAdmission("exit 17", {}, () => {
      admissions++;
      return Promise.resolve();
    })
  ).toThrow("local Workspace owner");
  expect(admissions).toBe(0);
  expect(f.counts().spawns).toBe(0);
});

it("admits one native execution when concurrent callers prepare the same command", async () => {
  const f = fixture();
  await Promise.all([f.start(), f.start()]);
  for (let step = 0; step < 10 && f.counts().spawns === 0; step++) {
    await Promise.all([f.poll(), f.poll()]);
  }
  expect(f.counts().spawns).toBe(1);
  expect((await f.record()).launchRequestedAt).toEqual(expect.any(Number));
  await Promise.all([f.poll(), f.poll()]);
  expect(f.counts().spawns).toBe(1);
});

it.each([
  "stop",
  "permission",
] as const)("does not dispatch after %s changes during preparation", async (change) => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  f.beforePreparation(() => {
    entered.resolve();
    return resume.promise;
  });
  const starting = f.start();
  const result = starting.catch((error) => error);
  await entered.promise;
  expect((await f.record()).launchRequestedAt).toBeUndefined();
  if (change === "stop") {
    await f.tool().execute({ action: "stop", key: "one" });
  } else {
    f.revoke();
  }
  resume.resolve();
  await result;
  expect(f.counts().spawns).toBe(0);
  expect((await f.record()).launchRequestedAt).toBeUndefined();
});
