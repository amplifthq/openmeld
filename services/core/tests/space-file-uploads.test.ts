import { env, runInDurableObject } from "cloudflare:test";
import { SPACE_FILE_UPLOAD_PART_BYTES } from "@openmeld/schemas";
import { expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { SpaceFileUploads } from "../src/space/application/space-file-uploads";
import type { Space } from "../src/space/transport/do/space";

const bindings = env as unknown as CoreBindings & {
  OPENMELD_SPACE_ATTACHMENTS: R2Bucket;
};
function stream(value: string | Uint8Array) {
  return new Blob([value]).stream();
}
async function checksum(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
}

it("resumes persisted parts, verifies original bytes, and completes once", async () => {
  const stub = bindings.OPENMELD_SPACES.get(
    bindings.OPENMELD_SPACES.newUniqueId()
  );
  await runInDurableObject(stub, async (_instance: Space, state) => {
    const uploads = new SpaceFileUploads(
      state.storage.sql,
      bindings.OPENMELD_SPACE_ATTACHMENTS
    );
    const uploadId = crypto.randomUUID();
    const bytes = new Uint8Array(SPACE_FILE_UPLOAD_PART_BYTES + 15);
    bytes.fill(79);
    let completed = 0;
    const input = {
      uploadId,
      actorId: "owner",
      scope: crypto.randomUUID(),
      finish: async (_metadata: unknown, key: string) => {
        completed++;
        const object = await bindings.OPENMELD_SPACE_ATTACHMENTS.get(key);
        if (!object) {
          throw new Error("Completed R2 object is missing");
        }
        expect(object.size).toBe(bytes.length);
        expect(await checksum(new Uint8Array(await object.arrayBuffer()))).toBe(
          await checksum(bytes)
        );
        return {
          upload: {
            id: uploadId,
            mimeType: "application/octet-stream",
            name: "sample.bin",
            sizeBytes: bytes.length,
            expiresAt: new Date(Date.now() + 1000).toISOString(),
          },
        };
      },
    };
    await uploads.execute({
      ...input,
      command: {
        action: "start",
        metadata: {
          mimeType: "application/octet-stream",
          sizeBytes: bytes.length,
          partDigests: [
            await checksum(bytes.slice(0, SPACE_FILE_UPLOAD_PART_BYTES)),
            await checksum(bytes.slice(SPACE_FILE_UPLOAD_PART_BYTES)),
          ],
          target: { kind: "composer", name: "sample.bin" },
        },
      },
    });
    await uploads.execute({
      ...input,
      command: { action: "part", partNumber: 1 },
      body: stream(bytes.slice(0, SPACE_FILE_UPLOAD_PART_BYTES)),
    });
    const resumed = new SpaceFileUploads(
      state.storage.sql,
      bindings.OPENMELD_SPACE_ATTACHMENTS
    );
    expect(
      (await resumed.execute({ ...input, command: { action: "status" } })).parts
    ).toHaveLength(1);
    await expect(
      resumed.execute({ ...input, command: { action: "complete" } })
    ).rejects.toThrow();
    await expect(
      resumed.execute({
        ...input,
        actorId: "someone-else",
        command: { action: "status" },
      })
    ).rejects.toThrow();
    await resumed.execute({
      ...input,
      command: { action: "part", partNumber: 2 },
      body: stream(bytes.slice(SPACE_FILE_UPLOAD_PART_BYTES)),
    });
    const result = await resumed.execute({
      ...input,
      command: { action: "complete" },
    });
    expect(
      await resumed.execute({ ...input, command: { action: "complete" } })
    ).toEqual(result);
    expect(completed).toBe(1);
  });
});

it("rejects an incorrect part length and cancels an unfinished upload", async () => {
  const stub = bindings.OPENMELD_SPACES.get(
    bindings.OPENMELD_SPACES.newUniqueId()
  );
  await runInDurableObject(stub, async (_instance: Space, state) => {
    const uploads = new SpaceFileUploads(
      state.storage.sql,
      bindings.OPENMELD_SPACE_ATTACHMENTS
    );
    const input = {
      uploadId: crypto.randomUUID(),
      actorId: "owner",
      scope: crypto.randomUUID(),
      finish: async () => ({}),
    };
    await uploads.execute({
      ...input,
      command: {
        action: "start",
        metadata: {
          mimeType: "text/plain",
          sizeBytes: 4,
          partDigests: [await checksum(new TextEncoder().encode("tiny"))],
          target: { kind: "composer", name: "tiny.txt" },
        },
      },
    });
    await expect(
      uploads.execute({
        ...input,
        command: { action: "part", partNumber: 1 },
        body: stream("too long"),
      })
    ).rejects.toThrow();
    expect(
      (await uploads.execute({ ...input, command: { action: "status" } })).parts
    ).toEqual([]);
    await expect(
      uploads.execute({
        ...input,
        command: { action: "part", partNumber: 1 },
        body: stream("fake"),
      })
    ).rejects.toThrow("does not match");
    expect(
      (await uploads.execute({ ...input, command: { action: "status" } })).parts
    ).toEqual([]);
    expect(
      (await uploads.execute({ ...input, command: { action: "cancel" } }))
        .cancelled
    ).toBe(true);
    await expect(
      uploads.execute({ ...input, command: { action: "complete" } })
    ).rejects.toThrow();
  });
});
