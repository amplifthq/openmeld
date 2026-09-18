import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spaceWorkSelectionSchema } from "@openmeld/schemas";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createSpaceWorkingCopies,
  type SpaceWorkingCopyTransport,
} from "../src/local-service/file-access/space-working-copy";

const selection = {
  schemaVersion: 1 as const,
  files: [{ fileId: "report", revision: 5, relativePath: "report.csv" }],
};
const scope = {
  accountId: "account",
  organizationId: "org",
  spaceId: "space",
  profileId: "profile",
  baseUrl: "https://example.test",
};

describe("managed Space working copies", () => {
  it("resumes a partial set without replacing a completed file's newer edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-partial-"));
    try {
      let available = false;
      const copies = createSpaceWorkingCopies({
        laneRoot: join(root, "lane"),
        scope,
        assertCurrentIdentity: async () => undefined,
        transport: {
          read: (fileId) => {
            if (fileId === "second" && !available) {
              return Promise.reject(new Error("offline"));
            }
            return Promise.resolve({
              bytes: Buffer.from(fileId),
              revision: 5,
              mimeType: "text/plain",
            });
          },
          get: async () => receipt(6),
          write: vi.fn(),
        },
      });
      const copyId = "11111111-1111-4111-8111-111111111111";
      await expect(
        copies.prepare(
          {
            schemaVersion: 1,
            files: [
              ...selection.files,
              { fileId: "second", revision: 5, relativePath: "second.txt" },
            ],
          },
          join(root, "work"),
          copyId
        )
      ).rejects.toThrow("incomplete");
      await writeFile(join(root, "work/report.csv"), "keep my edit");
      await expect(copies.commit(copyId)).rejects.toThrow("Finish preparing");
      available = true;
      await copies.resume(copyId);
      expect(await readFile(join(root, "work/report.csv"), "utf8")).toBe(
        "keep my edit"
      );
      expect(
        (await copies.status(copyId)).files.map((file) => file.status)
      ).toEqual(["changed", "clean"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("reconciles the frozen upload after response loss and preserves newer local edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-copy-"));
    try {
      const localPath = join(root, "work/report.csv");
      const writes: Parameters<SpaceWorkingCopyTransport["write"]>[0][] = [];
      const write = vi.fn<SpaceWorkingCopyTransport["write"]>(
        async (request) => {
          writes.push(request);
          if (writes.length === 1) {
            await writeFile(localPath, "later edit");
            throw new Error("response lost after commit");
          }
          return receipt(request.bytes.byteLength);
        }
      );
      const options = {
        laneRoot: join(root, "lane"),
        scope,
        assertCurrentIdentity: async () => undefined,
        transport: {
          read: async () => ({
            bytes: Buffer.from("original"),
            revision: 5,
            mimeType: "text/csv",
          }),
          get: async () => receipt(8),
          write,
        },
      };
      const copies = createSpaceWorkingCopies(options);
      const prepared = await copies.prepare(selection, join(root, "work"));
      await writeFile(localPath, "selected edit");
      await expect(copies.commit(prepared.copyId)).rejects.toThrow(
        "response lost"
      );
      const restarted = createSpaceWorkingCopies(options);
      await restarted.reconcile(prepared.copyId);
      expect(writes).toHaveLength(2);
      expect(writes[1]).toEqual(writes[0]);
      expect(Buffer.from(writes[1]?.bytes ?? []).toString()).toBe(
        "selected edit"
      );
      expect(await readFile(localPath, "utf8")).toBe("later edit");
      expect((await restarted.status(prepared.copyId)).files[0]).toMatchObject({
        revision: 6,
        status: "changed",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retains stale edits and rejects account changes and symlink substitution", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-copy-"));
    try {
      let current = true;
      const write = vi
        .fn<SpaceWorkingCopyTransport["write"]>()
        .mockRejectedValue(new Error("space_file.conflict"));
      const copies = createSpaceWorkingCopies({
        laneRoot: join(root, "lane"),
        scope,
        assertCurrentIdentity: () => {
          if (!current) {
            return Promise.reject(new Error("account changed"));
          }
          return Promise.resolve();
        },
        transport: {
          read: async () => ({
            bytes: Buffer.from([0, 255, 128]),
            revision: 5,
            mimeType: "application/octet-stream",
          }),
          get: async () => receipt(3),
          write,
        },
      });
      const prepared = await copies.prepare(selection, join(root, "work"));
      const file = join(prepared.root, "report.csv");
      await writeFile(file, "keep me");
      await expect(copies.commit(prepared.copyId)).rejects.toThrow(
        "space_file.conflict"
      );
      expect(await readFile(file, "utf8")).toBe("keep me");
      current = false;
      await expect(copies.commit(prepared.copyId)).rejects.toThrow(
        "account changed"
      );
      expect(write).toHaveBeenCalledTimes(1);
      current = true;
      await writeFile(join(root, "private"), "secret");
      await rm(file);
      await symlink(join(root, "private"), file);
      await expect(copies.status(prepared.copyId)).rejects.toThrow();
      expect(await readFile(join(root, "private"), "utf8")).toBe("secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    "../escape",
    "/absolute",
    "C:/drive",
    "a\\b",
    "NUL.txt",
    "folder/../escape",
    ".git/config",
    "report.",
  ])("rejects unsafe selection %s", (relativePath) => {
    expect(
      spaceWorkSelectionSchema.safeParse({
        ...selection,
        files: [{ ...selection.files[0], relativePath }],
      }).success
    ).toBe(false);
  });
});

function receipt(sizeBytes: number): SpaceFileDescriptor {
  const actor = {
    displayName: "Member",
    ownerUserId: "account",
    profileId: "profile",
    profileKind: "human" as const,
  };
  const createdAt = "2026-09-19T00:00:00.000Z";
  return {
    id: "report",
    kind: "file",
    name: "report.csv",
    path: "/report.csv",
    spaceId: "space",
    parentId: null,
    createdAt,
    updatedAt: createdAt,
    createdBy: actor,
    updatedBy: actor,
    trashedAt: null,
    trashedBy: null,
    latestRevision: {
      id: "revision-6",
      fileId: "report",
      revision: 6,
      mimeType: "text/csv",
      sizeBytes,
      createdAt,
      createdBy: actor,
    },
  };
}
