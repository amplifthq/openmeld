import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import { spaceWorkSelectionSchema } from "@openmeld/schemas";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createSpaceWorkingCopies,
  type SpaceWorkingCopyTransport,
} from "../src/local-service/file-access/space-working-copy";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

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

// Native containment is currently macOS only: https://github.com/amplifthq/openmeld/pull/1164
describe.skipIf(process.platform !== "darwin")(
  "managed Space working copies",
  () => {
    it.each([
      false,
      true,
    ])("resolves rejected writes without redundant uploads when contents converge (%s)", async (converged) => {
      const root = await mkdtemp(join(tmpdir(), "openmeld-conflict-"));
      try {
        const incomingContent = converged ? "local edit" : "remote edit";
        let remoteRevision = 6;
        const writes: Parameters<SpaceWorkingCopyTransport["write"]>[0][] = [];
        const options = {
          laneRoot: join(root, "lane"),
          scope,
          assertCurrentIdentity: async () => undefined,
          transport: {
            read: async (_id: string, revision: number) => ({
              bytes: Buffer.from(revision === 5 ? "original" : incomingContent),
              revision,
              mimeType: "text/plain",
            }),
            get: async () => receipt(11),
            write: (
              request: Parameters<SpaceWorkingCopyTransport["write"]>[0]
            ) => {
              writes.push(request);
              if (request.baseRevision !== remoteRevision) {
                return Promise.reject(
                  new OpenMeldApiClientHttpError({
                    code: "gateway.http_error",
                    upstreamCode: "space_file.conflict",
                    status: 409,
                    rawBody: "",
                    message: "stale base",
                  })
                );
              }
              const saved = receipt(request.bytes.length);
              saved.latestRevision.revision = 7;
              return Promise.resolve(saved);
            },
          },
        };
        const copies = createSpaceWorkingCopies(options);
        const prepared = await copies.prepare(selection, join(root, "work"));
        const path = join(prepared.root, "report.csv");
        await writeFile(path, "local edit");
        await expect(copies.commit(prepared.copyId)).rejects.toThrow(
          "stale base"
        );
        const restarted = createSpaceWorkingCopies(options);
        await expect(restarted.reconcile(prepared.copyId)).rejects.toThrow(
          "Resolve"
        );
        expect(writes).toHaveLength(1);
        await expect(
          restarted.resolve(prepared.copyId, "report", 6)
        ).rejects.toThrow("explicitly select");
        await restarted.refresh(prepared.copyId);
        const status = (await restarted.status(prepared.copyId)).files[0];
        expect(status).toMatchObject({
          status: "conflict",
          incomingRevision: 6,
        });
        expect(
          await readFile(
            join(prepared.root, status?.incomingPath ?? ""),
            "utf8"
          )
        ).toBe(converged ? "local edit" : "remote edit");
        expect(await readFile(path, "utf8")).toBe("local edit");
        await expect(
          restarted.resolve(prepared.copyId, "report", 7)
        ).rejects.toThrow("explicitly select");
        if (converged) {
          await restarted.resolve(prepared.copyId, "report", 6);
          const saved = await restarted.commit(prepared.copyId);
          expect(saved.references[0]).toMatchObject({
            fileId: "report",
            revision: 6,
          });
          expect(writes).toHaveLength(1);
          expect(
            (await restarted.status(prepared.copyId)).files[0]?.status
          ).toBe("clean");
          remoteRevision = 7;
          await writeFile(path, "another local edit");
          await expect(restarted.commit(prepared.copyId)).rejects.toThrow(
            "stale base"
          );
          expect(writes[1]?.baseRevision).toBe(6);
          return;
        }
        await expect(
          restarted.resolve(prepared.copyId, "report", 6)
        ).rejects.toThrow("Merge");
        await writeFile(path, "remote edit + local edit");
        await restarted.resolve(prepared.copyId, "report", 6);
        const saved = await restarted.commit(prepared.copyId);
        expect(saved.references[0]).toMatchObject({
          fileId: "report",
          revision: 7,
        });
        expect(writes[1]?.baseRevision).toBe(6);
        expect(writes[1]?.clientMutationId).not.toBe(
          writes[0]?.clientMutationId
        );
        expect(Buffer.from(writes[1]?.bytes ?? []).toString()).toBe(
          "remote edit + local edit"
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("rejects an intermediate symlink installed after path checks but before open", async () => {
      const root = await mkdtemp(join(tmpdir(), "openmeld-path-race-"));
      try {
        const write = vi.fn();
        const copies = createSpaceWorkingCopies({
          laneRoot: join(root, "lane"),
          scope,
          assertCurrentIdentity: async () => undefined,
          transport: {
            read: async () => ({
              bytes: Buffer.from("safe"),
              revision: 5,
              mimeType: "text/plain",
            }),
            get: async () => receipt(4),
            write,
          },
        });
        const prepared = await copies.prepare(
          {
            schemaVersion: 1,
            files: [
              {
                fileId: "report",
                revision: 5,
                relativePath: "nested/report.csv",
              },
            ],
          },
          join(root, "work")
        );
        await mkdir(join(root, "private"));
        await writeFile(join(root, "private/report.csv"), "private sentinel");
        const { open: originalOpen } =
          await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises"
          );
        const spy = vi.mocked(open).mockImplementation(async (...args) => {
          if (args[0] === join(prepared.root, "nested/report.csv")) {
            spy.mockRestore();
            await rename(
              join(prepared.root, "nested"),
              join(prepared.root, "old")
            );
            await symlink(join(root, "private"), join(prepared.root, "nested"));
          }
          return originalOpen(...args);
        });
        await expect(copies.commit(prepared.copyId)).rejects.toThrow();
        expect(write).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
        await rm(root, { recursive: true, force: true });
      }
    });
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
        expect(
          (await readdir(join(root, "lane"), { recursive: true })).filter(
            (path) => path.endsWith(".bin")
          )
        ).toHaveLength(1);
        // CLI constructs its scope in a different order from Service preparation.
        const restarted = createSpaceWorkingCopies({
          ...options,
          scope: {
            accountId: scope.accountId,
            organizationId: scope.organizationId,
            profileId: scope.profileId,
            spaceId: scope.spaceId,
            baseUrl: scope.baseUrl,
          },
        });
        await restarted.reconcile(prepared.copyId);
        expect(
          (await readdir(join(root, "lane"), { recursive: true })).filter(
            (path) => path.endsWith(".bin")
          )
        ).toHaveLength(0);
        expect(writes).toHaveLength(2);
        expect(writes[1]).toEqual(writes[0]);
        expect(Buffer.from(writes[1]?.bytes ?? []).toString()).toBe(
          "selected edit"
        );
        expect(await readFile(localPath, "utf8")).toBe("later edit");
        expect(
          (await restarted.status(prepared.copyId)).files[0]
        ).toMatchObject({
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
  }
);

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
    origin: "artifact",
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
