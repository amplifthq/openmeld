import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { systemDir } from "../src/config/paths";
import {
  acquireExecutionHostOwnership,
  readExecutionHostBootIdentity,
} from "../src/local-service/execution-host/ownership";

describe("execution Host durable process ownership", () => {
  let root: string;
  const releases: Array<() => Promise<void>> = [];
  const firstBoot = "darwin:811b4099-be87-4efc-8cc6-20a7ef71a2ed";
  const secondBoot = "darwin:c615b170-8643-4d12-b5b6-7ea5ab222d99";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-host-owner-"));
  });
  afterEach(async () => {
    await Promise.all(releases.splice(0).map((release) => release()));
    await rm(root, { recursive: true, force: true });
  });
  const acquire = async (
    bootIdentity: string | null,
    ownerUserId = "test-owner"
  ) => {
    const owner = await acquireExecutionHostOwnership({
      stateRoot: root,
      hostInstanceId: randomUUID(),
      ownerUserId,
      deviceId: "test-device",
      lane: "dev-local",
      bootIdentity,
    });
    releases.push(owner.release);
    return owner;
  };
  const receiptPath = () =>
    join(
      systemDir({ env: { OPENMELD_HOME: root } }),
      "execution-host-owner.json"
    );

  it("allows an empty/quiescent installation without reboot evidence and retains one owner", async () => {
    const first = await acquire(null);
    await expect(acquire(null)).rejects.toThrow();
    await first.release();
    const next = await acquire(null);
    expect(
      JSON.parse(await readFile(receiptPath(), "utf8")).localQuiescent
    ).toBe(true);
    await next.release();
  });

  it.each([
    [firstBoot, firstBoot, false],
    [firstBoot, secondBoot, true],
    [firstBoot, null, false],
    [null, secondBoot, false],
    ["win32:100:638900000000000000", "win32:101:638900000000000001", true],
    ["win32:100:638900000000000000", "win32:100:638900000000000002", false],
    ["win32:100:638900000000000000", "win32:1:638900000000000002", false],
  ] as const)("does not replace unknown local work without trustworthy reboot evidence (%s → %s)", async (before, after, recover) => {
    const first = await acquire(before);
    first.observeLocalQuiescence(false);
    await first.release();
    const retained = await readFile(receiptPath(), "utf8");
    if (recover) {
      const replacement = await acquire(after);
      expect(
        JSON.parse(await readFile(receiptPath(), "utf8")).localQuiescent
      ).toBe(true);
      await replacement.release();
    } else {
      await expect(acquire(after, "another-account")).rejects.toMatchObject({
        code: "host.previous_work_unconfirmed",
      });
      expect(await readFile(receiptPath(), "utf8")).toBe(retained);
    }
  });

  it("allows confirmed quiescence, but never replaces a corrupt ownership record", async () => {
    const first = await acquire(firstBoot);
    first.observeLocalQuiescence(false);
    first.observeLocalQuiescence(true);
    await first.release();
    const next = await acquire(firstBoot);
    await next.release();
    await writeFile(receiptPath(), "{broken");
    await expect(acquire(secondBoot)).rejects.toThrow();
    expect(await readFile(receiptPath(), "utf8")).toBe("{broken");
  });

  it("reads stable same-boot evidence through the local operating system", async () => {
    const first = await readExecutionHostBootIdentity();
    const second = await readExecutionHostBootIdentity();
    expect(second).toBe(first);
    if (process.platform === "darwin" || process.platform === "linux") {
      expect(first?.startsWith(`${process.platform}:`)).toBe(true);
    }
  });
});
