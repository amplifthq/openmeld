import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComputerFileAccessPolicy } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  readComputerFileAccessPolicy,
  updateComputerFileAccessPolicy,
} from "../src/local-service/file-access/computer-file-access-store";

const tempDirs: string[] = [];
const INCOMPATIBLE_STORE_PATTERN =
  /computer file access store is incompatible/i;

async function makeTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmeld-file-access-"));
  tempDirs.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { force: true, recursive: true });
    })
  );
});

describe("Computer file access store", () => {
  it("returns the local-agent default without creating state", async () => {
    const root = await makeTempDir();
    const policy = await readComputerFileAccessPolicy(
      join(root, "policy.json")
    );

    expect(policy).toEqual({
      mode: "local_agent_settings",
      revision: 1,
      updatedAtMs: 0,
    });
  });

  it("keeps a store read failure local while returning a stable error", async () => {
    const root = await makeTempDir();

    const error = await readComputerFileAccessPolicy(root).catch(
      (cause: unknown) => cause
    );

    expect(error).toMatchObject({
      code: "computer.file_access.internal_error",
      localDiagnosticContext: {
        errorCode: "EISDIR",
        operation: "read_store",
        path: root,
        reason: "io_error",
      },
    });
    expect((error as Error).message).not.toContain(root);
    expect(JSON.stringify(error)).not.toContain(root);
  });

  it("keeps a folder canonicalization failure local while returning a stable error", async () => {
    const root = await makeTempDir();
    const loop = join(root, "loop");
    await symlink(loop, loop);

    const error = await updateComputerFileAccessPolicy({
      expectedRevision: 1,
      idempotencyKey: "symlink-loop",
      nowMs: 100,
      policy: {
        folders: [loop],
        mode: "only_selected_folders",
      },
      storePath: join(root, "policy.json"),
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "computer.file_access.internal_error",
      localDiagnosticContext: {
        errorCode: "ELOOP",
        operation: "canonicalize_folder",
        path: loop,
        reason: "io_error",
      },
    });
    expect((error as Error).message).not.toContain(loop);
    expect(JSON.stringify(error)).not.toContain(loop);
  });

  it("canonicalizes, deduplicates, and persists selected folders atomically", async () => {
    const root = await makeTempDir();
    const parent = join(root, "work");
    const child = join(parent, "project");
    const alias = join(root, "alias");
    await mkdir(child, { recursive: true });
    await symlink(parent, alias);
    const storePath = join(root, "policy.json");

    const updated = await updateComputerFileAccessPolicy({
      expectedRevision: 1,
      idempotencyKey: "update-1",
      nowMs: 100,
      policy: {
        folders: [child, alias, parent],
        mode: "only_selected_folders",
      },
      storePath,
    });

    expect(updated).toEqual({
      folders: [await realpath(parent)],
      mode: "only_selected_folders",
      revision: 2,
      updatedAtMs: 100,
    });
    expect(await readComputerFileAccessPolicy(storePath)).toEqual(updated);
  });

  it("reuses the exact result for a repeated idempotency key", async () => {
    const root = await makeTempDir();
    const folder = join(root, "work");
    await mkdir(folder);
    const storePath = join(root, "policy.json");
    const first = await updateComputerFileAccessPolicy({
      expectedRevision: 1,
      idempotencyKey: "same-request",
      nowMs: 100,
      policy: { folders: [folder], mode: "block_selected_folders" },
      storePath,
    });
    const replay = await updateComputerFileAccessPolicy({
      expectedRevision: 1,
      idempotencyKey: "same-request",
      nowMs: 200,
      policy: { folders: [folder], mode: "block_selected_folders" },
      storePath,
    });

    expect(replay).toEqual(first);
  });

  it("returns the original result without restoring an older policy", async () => {
    const root = await makeTempDir();
    const firstFolder = join(root, "first");
    const secondFolder = join(root, "second");
    await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
    const storePath = join(root, "policy.json");
    const firstRequest = {
      expectedRevision: 1,
      idempotencyKey: "request-a",
      nowMs: 100,
      policy: {
        folders: [firstFolder],
        mode: "only_selected_folders" as const,
      },
      storePath,
    };
    const first = await updateComputerFileAccessPolicy(firstRequest);
    const second = await updateComputerFileAccessPolicy({
      expectedRevision: 2,
      idempotencyKey: "request-b",
      nowMs: 200,
      policy: {
        folders: [secondFolder],
        mode: "only_selected_folders",
      },
      storePath,
    });

    const replay = await updateComputerFileAccessPolicy(firstRequest);

    expect(replay).toEqual(first);
    expect(await readComputerFileAccessPolicy(storePath)).toEqual(second);
  });

  it("rejects an idempotency key reused with a different request", async () => {
    const root = await makeTempDir();
    const folder = join(root, "work");
    await mkdir(folder);
    const storePath = join(root, "policy.json");
    await updateComputerFileAccessPolicy({
      expectedRevision: 1,
      idempotencyKey: "colliding-request",
      nowMs: 100,
      policy: { folders: [folder], mode: "only_selected_folders" },
      storePath,
    });

    await expect(
      updateComputerFileAccessPolicy({
        expectedRevision: 1,
        idempotencyKey: "colliding-request",
        nowMs: 200,
        policy: { mode: "local_agent_settings" },
        storePath,
      })
    ).rejects.toMatchObject({
      code: "computer.file_access.invalid_request",
    });
  });

  it("rejects an evicted state-changing request through revision CAS", async () => {
    const root = await makeTempDir();
    const firstFolder = join(root, "first");
    const secondFolder = join(root, "second");
    await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
    const storePath = join(root, "policy.json");
    const firstRequest = {
      expectedRevision: 1,
      idempotencyKey: "evicted-request",
      nowMs: 100,
      policy: {
        folders: [firstFolder],
        mode: "only_selected_folders" as const,
      },
      storePath,
    };
    await updateComputerFileAccessPolicy(firstRequest);
    const current = await updateComputerFileAccessPolicy({
      expectedRevision: 2,
      idempotencyKey: "current-request",
      nowMs: 200,
      policy: {
        folders: [secondFolder],
        mode: "only_selected_folders",
      },
      storePath,
    });
    for (let index = 0; index < 64; index += 1) {
      await updateComputerFileAccessPolicy({
        expectedRevision: current.revision,
        idempotencyKey: `history-${String(index)}`,
        nowMs: 300 + index,
        policy: {
          folders: [secondFolder],
          mode: "only_selected_folders",
        },
        storePath,
      });
    }

    await expect(
      updateComputerFileAccessPolicy(firstRequest)
    ).rejects.toMatchObject({
      code: "computer.file_access.revision_mismatch",
    });
    expect(await readComputerFileAccessPolicy(storePath)).toEqual(current);
  });

  it("records a new idempotency key when the policy value is unchanged", async () => {
    const root = await makeTempDir();
    const folder = join(root, "work");
    await mkdir(folder);
    const storePath = join(root, "policy.json");
    const first = await updateComputerFileAccessPolicy({
      expectedRevision: 1,
      idempotencyKey: "first-request",
      nowMs: 100,
      policy: { folders: [folder], mode: "block_selected_folders" },
      storePath,
    });
    const unchanged = await updateComputerFileAccessPolicy({
      expectedRevision: 2,
      idempotencyKey: "unchanged-request",
      nowMs: 200,
      policy: { folders: [folder], mode: "block_selected_folders" },
      storePath,
    });
    const replay = await updateComputerFileAccessPolicy({
      expectedRevision: 2,
      idempotencyKey: "unchanged-request",
      nowMs: 300,
      policy: { folders: [folder], mode: "block_selected_folders" },
      storePath,
    });

    expect(unchanged).toEqual(first);
    expect(replay).toEqual(first);
  });

  it("serializes concurrent updates and rejects the stale writer", async () => {
    const root = await makeTempDir();
    const firstFolder = join(root, "first");
    const secondFolder = join(root, "second");
    await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
    const storePath = join(root, "policy.json");

    const [first, second] = await Promise.allSettled([
      updateComputerFileAccessPolicy({
        expectedRevision: 1,
        idempotencyKey: "concurrent-first",
        nowMs: 100,
        policy: {
          folders: [firstFolder],
          mode: "only_selected_folders",
        },
        storePath,
      }),
      updateComputerFileAccessPolicy({
        expectedRevision: 1,
        idempotencyKey: "concurrent-second",
        nowMs: 200,
        policy: {
          folders: [secondFolder],
          mode: "only_selected_folders",
        },
        storePath,
      }),
    ]);

    expect(first.status).toBe("fulfilled");
    expect(second).toMatchObject({
      reason: { code: "computer.file_access.revision_mismatch" },
      status: "rejected",
    });
    if (first.status !== "fulfilled") {
      throw first.reason;
    }
    expect(first.value.revision).toBe(2);
    expect(await readComputerFileAccessPolicy(storePath)).toEqual(first.value);
  });

  it("fails loudly for an unknown store version", async () => {
    const root = await makeTempDir();
    const storePath = join(root, "policy.json");
    await writeFile(
      storePath,
      JSON.stringify({ schema: "openmeld-computer-file-access-v99" }),
      "utf8"
    );

    const error = await readComputerFileAccessPolicy(storePath).catch(
      (cause: unknown) => cause
    );

    expect((error as Error).message).toMatch(INCOMPATIBLE_STORE_PATTERN);
    expect((error as Error).message).not.toContain(storePath);
    expect(error).toMatchObject({
      code: "computer.file_access.invalid_response",
      localDiagnosticContext: {
        reason: "incompatible_schema",
        storePath,
      },
    });
    expect(JSON.stringify(error)).not.toContain(storePath);
  });

  it("does not expose store metadata as policy state", async () => {
    const root = await makeTempDir();
    const storePath = join(root, "policy.json");
    const policy: ComputerFileAccessPolicy = {
      mode: "local_agent_settings",
      revision: 2,
      updatedAtMs: 100,
    };
    await writeFile(
      storePath,
      JSON.stringify({
        schema: "openmeld-computer-file-access-v1",
        lastIdempotencyKey: "private-request-key",
        policy,
      }),
      "utf8"
    );

    expect(await readComputerFileAccessPolicy(storePath)).toEqual(policy);
  });
});
