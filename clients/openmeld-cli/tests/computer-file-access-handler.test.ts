import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleComputerFileAccessFrame } from "../src/local-service/file-access/computer-file-access-handler";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmeld-file-access-handler-"));
  tempDirs.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("Computer file access handler", () => {
  it("reads the default policy for the exact Computer", async () => {
    const root = await makeTempDir();
    const response = await handleComputerFileAccessFrame({
      deviceId: "device-1",
      frame: {
        code: "daemon.computer_file_access.read_policy",
        payload: {
          request: { expectedDeviceId: "device-1" },
          requestId: "request-1",
        },
        v: 1,
      },
      storePath: join(root, "policy.json"),
    });

    expect(response).toEqual({
      code: "daemon.computer_file_access.read_policy_result",
      payload: {
        requestId: "request-1",
        result: {
          deviceId: "device-1",
          policy: {
            mode: "local_agent_settings",
            revision: 1,
            updatedAtMs: 0,
          },
        },
      },
      v: 1,
    });
  });

  it("rejects a request targeting another Computer without reading policy", async () => {
    const root = await makeTempDir();
    const response = await handleComputerFileAccessFrame({
      deviceId: "device-1",
      frame: {
        code: "daemon.computer_file_access.read_policy",
        payload: {
          request: { expectedDeviceId: "device-2" },
          requestId: "request-2",
        },
        v: 1,
      },
      storePath: join(root, "policy.json"),
    });

    expect(response.payload.result).toMatchObject({
      code: "computer.file_access.device_mismatch",
      status: "rejected",
    });
  });

  it("returns canonical policy state after an update", async () => {
    const root = await makeTempDir();
    const folder = join(root, "work");
    await mkdir(folder);
    const response = await handleComputerFileAccessFrame({
      deviceId: "device-1",
      frame: {
        code: "daemon.computer_file_access.update_policy",
        payload: {
          request: {
            expectedDeviceId: "device-1",
            expectedRevision: 1,
            idempotencyKey: "update-1",
            policy: {
              folders: [folder],
              mode: "only_selected_folders",
            },
          },
          requestId: "request-3",
        },
        v: 1,
      },
      nowMs: 100,
      storePath: join(root, "policy.json"),
    });

    expect(response.payload.result).toEqual({
      deviceId: "device-1",
      policy: {
        folders: [await realpath(folder)],
        mode: "only_selected_folders",
        revision: 2,
        updatedAtMs: 100,
      },
    });
  });

  it("returns a revision conflict instead of overwriting newer policy", async () => {
    const root = await makeTempDir();
    const folder = join(root, "work");
    const storePath = join(root, "policy.json");
    await mkdir(folder);
    const createUpdateFrame = (idempotencyKey: string) => ({
      code: "daemon.computer_file_access.update_policy" as const,
      payload: {
        request: {
          expectedDeviceId: "device-1",
          expectedRevision: 1,
          idempotencyKey,
          policy: {
            folders: [folder],
            mode: "only_selected_folders" as const,
          },
        },
        requestId: idempotencyKey,
      },
      v: 1 as const,
    });
    await handleComputerFileAccessFrame({
      deviceId: "device-1",
      frame: createUpdateFrame("first-update"),
      nowMs: 100,
      storePath,
    });

    const staleResponse = await handleComputerFileAccessFrame({
      deviceId: "device-1",
      frame: createUpdateFrame("stale-update"),
      nowMs: 200,
      storePath,
    });

    expect(staleResponse.payload.result).toMatchObject({
      code: "computer.file_access.revision_mismatch",
      status: "rejected",
    });
  });

  it("keeps the lane-local store path out of the Service result", async () => {
    const root = await makeTempDir();
    const storePath = join(root, "policy.json");
    await writeFile(storePath, "not-json", "utf8");

    const response = await handleComputerFileAccessFrame({
      deviceId: "device-1",
      frame: {
        code: "daemon.computer_file_access.read_policy",
        payload: {
          request: { expectedDeviceId: "device-1" },
          requestId: "malformed-store",
        },
        v: 1,
      },
      storePath,
    });

    expect(response.payload.result).toMatchObject({
      code: "computer.file_access.invalid_response",
      status: "rejected",
    });
    expect(JSON.stringify(response)).not.toContain(storePath);
  });
});
