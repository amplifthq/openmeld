import { runInDurableObject } from "cloudflare:test";
import { SPACE_FILE_UPLOAD_PART_BYTES } from "@openmeld/schemas";
import { expect, it, vi } from "vitest";
import { FileUploadSessions } from "../src/files/file-upload-sessions";
import { AlarmFailureBackoff } from "../src/lib/alarm-failure-backoff";
import type { CoreBindings } from "../src/lib/bindings";
import type { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";

const bindings = env as unknown as CoreBindings & {
  OPENMELD_SPACE_ATTACHMENTS: R2Bucket;
};

it("backs off failed Space cleanup durably without blocking healthy work, then stops after recovery", async () => {
  const stub = bindings.OPENMELD_SPACES.get(
    bindings.OPENMELD_SPACES.newUniqueId()
  );
  await runInDurableObject(stub, async (instance: Space, state) => {
    // Keep virtual deadlines ahead of Workerd's real-clock past-alarm normalization.
    const start = Date.now() + 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    try {
      const uploads = new FileUploadSessions(
        state.storage.sql,
        bindings.OPENMELD_SPACE_ATTACHMENTS
      );
      const key = `cleanup-test/${crypto.randomUUID()}`;
      await bindings.OPENMELD_SPACE_ATTACHMENTS.put(key, "expired");
      state.storage.sql.exec(
        "INSERT INTO space_file_upload_sessions VALUES (?, ?, ?)",
        "bad",
        start - 2,
        "invalid json"
      );
      state.storage.sql.exec(
        "INSERT INTO space_file_upload_sessions VALUES (?, ?, ?)",
        "good",
        start - 1,
        JSON.stringify({ key, response: { cancelled: false } })
      );

      // Manual handler calls must consume the scheduled alarm as Workerd does on delivery.
      await state.storage.deleteAlarm();
      await instance.alarm();
      expect(await state.storage.getAlarm()).toBe(start + 5000);
      expect(await bindings.OPENMELD_SPACE_ATTACHMENTS.head(key)).toBeNull();
      expect(uploads.hasUploads()).toBe(true);

      // Another event wakes the object during cooldown. The failed lane must not run again.
      await instance.alarm();
      expect(await state.storage.getAlarm()).toBe(start + 5000);
      let backoff = new AlarmFailureBackoff(state.storage);
      expect(await backoff.canRun("file_upload_cleanup", start + 4999)).toBe(
        false
      );
      expect(
        await backoff.nextAlarmAt({
          healthy: start + 1000,
          file_upload_cleanup: start - 2,
        })
      ).toBe(start + 1000);

      clock.mockReturnValue(start + 5000);
      await state.storage.deleteAlarm();
      await instance.alarm();
      expect(await state.storage.getAlarm()).toBe(start + 15_000);
      backoff = new AlarmFailureBackoff(state.storage);
      expect(await backoff.canRun("file_upload_cleanup", start + 14_999)).toBe(
        false
      );

      let retryAtMs = start + 15_000;
      for (const delayMs of [
        20_000, 40_000, 80_000, 160_000, 300_000, 300_000,
      ]) {
        clock.mockReturnValue(retryAtMs);
        await state.storage.deleteAlarm();
        await instance.alarm();
        expect(await state.storage.getAlarm()).toBe(retryAtMs + delayMs);
        retryAtMs += delayMs;
      }
      // Repair the retained corrupt record; no new upload or user request is required.
      state.storage.sql.exec(
        "UPDATE space_file_upload_sessions SET state = ? WHERE id = ?",
        JSON.stringify({ key, response: { cancelled: true } }),
        "bad"
      );
      clock.mockReturnValue(retryAtMs);
      await state.storage.deleteAlarm();
      await instance.alarm();
      expect(uploads.hasUploads()).toBe(false);
      expect(await state.storage.getAlarm()).toBeNull();
      expect(
        await new AlarmFailureBackoff(state.storage).retryAt(
          "file_upload_cleanup"
        )
      ).toBeNull();
    } finally {
      clock.mockRestore();
      await state.storage.deleteAlarm();
    }
  });
});
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
    const uploads = new FileUploadSessions(
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
    const resumed = new FileUploadSessions(
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
    const uploads = new FileUploadSessions(
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
