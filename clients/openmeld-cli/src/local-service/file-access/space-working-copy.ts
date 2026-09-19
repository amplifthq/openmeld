import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import {
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  SPACE_WORK_MAX_BYTES,
  type SpaceWorkSelection,
  spaceWorkRelativePathSchema,
  spaceWorkSelectionSchema,
} from "@openmeld/schemas";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { z } from "zod/v4";
import { acquireLock, releaseLock } from "../../config/lock";
import { createLedgerIo } from "../state/ledger-io";

const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
// Darwin open(2): reject symlinks in every path component atomically. Node
// does not expose this flag, but forwards numeric flags to the native open.
// https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/fcntl.h
const O_NOFOLLOW_ANY = 0x20_00_00_00;
const CREATE_FLAGS =
  // biome-ignore lint/suspicious/noBitwiseOperators: Node file-open flags are a bit mask.
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW_ANY;
// biome-ignore lint/suspicious/noBitwiseOperators: Reject a substituted leaf symlink.
const READ_FLAGS = constants.O_RDONLY | O_NOFOLLOW_ANY | constants.O_NONBLOCK;
const fileStateSchema = z.object({
  fileId: z.string(),
  relativePath: spaceWorkRelativePathSchema,
  revision: z.number().int().positive(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  baseHash: z.string().optional(),
  conflict: z
    .object({
      digest: z.string(),
      mutationId: z.string().uuid(),
      incoming: z
        .object({
          revision: z.number().int().positive(),
          relativePath: spaceWorkRelativePathSchema,
          digest: z.string(),
          mimeType: z.string(),
          sizeBytes: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .optional(),
  pending: z
    .object({
      mutationId: z.string().uuid(),
      digest: z.string(),
      baseRevision: z.number().int().positive(),
    })
    .optional(),
});
const stateSchema = z.object({
  schemaVersion: z.literal(1),
  copyId: z.string().uuid(),
  scope: z.string(),
  root: z.string(),
  rootDevice: z.number(),
  rootInode: z.number(),
  files: z.array(fileStateSchema).min(1).max(10),
});
type State = z.infer<typeof stateSchema>;

export type SpaceWorkingCopyTransport = {
  read(
    fileId: string,
    revision: number
  ): Promise<{ bytes: Uint8Array; revision: number; mimeType: string }>;
  get(fileId: string): Promise<SpaceFileDescriptor>;
  write(input: {
    fileId: string;
    baseRevision: number;
    bytes: Uint8Array;
    mimeType: string;
    clientMutationId: string;
  }): Promise<SpaceFileDescriptor>;
};

/** Local receipts only. Every network operation still uses ordinary Space authorization. */
export function createSpaceWorkingCopies(input: {
  laneRoot: string;
  scope: {
    accountId: string;
    organizationId: string;
    spaceId: string;
    profileId: string;
    baseUrl: string;
  };
  transport: SpaceWorkingCopyTransport;
  assertCurrentIdentity(): Promise<void>;
}) {
  if (process.platform !== "darwin") {
    throw new Error(
      "Managed working copies are not supported on this platform yet. Use explicit file download and write commands."
    );
  }
  // Service preparation and CLI recovery construct these fields independently.
  // Preserve the Service's existing record identity, independent of insertion order.
  const scope = hash(
    JSON.stringify({
      accountId: input.scope.accountId,
      organizationId: input.scope.organizationId,
      spaceId: input.scope.spaceId,
      profileId: input.scope.profileId,
      baseUrl: input.scope.baseUrl,
    })
  );
  const directory = join(input.laneRoot, "space-working-copies", scope);
  const metadataPath = (id: string) =>
    join(directory, `${z.string().uuid().parse(id)}.json`);

  async function save(state: State) {
    const path = metadataPath(state.copyId);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeDurablePrivateFile(temporary, JSON.stringify(state));
    await rename(temporary, path);
    await createLedgerIo().syncPath(directory);
  }

  async function owned<T>(id: string, run: (state: State) => Promise<T>) {
    const lock = await acquireLock({
      openMeldProfileId: input.scope.profileId,
      key: `space-copy:${scope}:${id}`,
      pathResolution: {
        env: { ...process.env, OPENMELD_HOME: input.laneRoot },
      },
    });
    try {
      await input.assertCurrentIdentity();
      const state = stateSchema.parse(
        JSON.parse(await readFile(metadataPath(id), "utf8"))
      );
      if (state.scope !== scope || state.copyId !== id) {
        throw new Error(
          "This working copy belongs to another account or Space."
        );
      }
      await verifyRoot(state);
      return await run(state);
    } finally {
      await releaseLock(lock);
    }
  }

  async function prepareFiles(state: State) {
    let total = 0;
    for (const file of state.files) {
      if (file.baseHash) {
        continue;
      }
      await input.assertCurrentIdentity();
      const remote = await input.transport.read(file.fileId, file.revision);
      total += remote.bytes.byteLength;
      if (
        remote.revision !== file.revision ||
        remote.bytes.byteLength > SPACE_FILE_RAW_UPLOAD_MAX_BYTES ||
        total > SPACE_WORK_MAX_BYTES
      ) {
        throw new Error(
          "The selected files exceed transfer limits or do not match their revisions."
        );
      }
      const path = await safePath(state, file.relativePath, true);
      const current = await localBytes(state, file.relativePath);
      if (current && hash(current) !== hash(remote.bytes)) {
        throw new Error(
          "Preparation found local changes. Keep this copy and prepare a new directory."
        );
      }
      if (!current) {
        const handle = await open(path, CREATE_FLAGS, 0o600);
        try {
          await handle.writeFile(remote.bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      file.baseHash = hash(remote.bytes);
      file.mimeType = remote.mimeType;
      file.sizeBytes = remote.bytes.byteLength;
      await save(state);
    }
    return { copyId: state.copyId, root: state.root, ready: true };
  }

  async function submitPending(state: State, file: State["files"][number]) {
    if (file.conflict) {
      throw new Error(
        "Resolve the file conflict before saving. Use refresh to retrieve the shared version, merge your edits, then resolve with its file ID and revision."
      );
    }
    if (!(file.pending && file.mimeType)) {
      return;
    }
    const pending = file.pending;
    const bytes = await readFile(join(directory, `${pending.mutationId}.bin`));
    if (hash(bytes) !== pending.digest) {
      throw new Error(
        "The pending upload snapshot is damaged. Local edits have been preserved."
      );
    }
    await input.assertCurrentIdentity();
    const receipt = await input.transport
      .write({
        fileId: file.fileId,
        baseRevision: pending.baseRevision,
        bytes,
        mimeType: file.mimeType,
        clientMutationId: pending.mutationId,
      })
      .catch(async (error: unknown) => {
        if (
          error instanceof OpenMeldApiClientHttpError &&
          error.status === 409 &&
          (error.code === "space_file.conflict" ||
            error.upstreamCode === "space_file.conflict")
        ) {
          // A definite rejection is not an unknown outcome. Keep the rejected
          // snapshot, but never retry it or silently advance its base revision.
          file.conflict = {
            digest: pending.digest,
            mutationId: pending.mutationId,
          };
          file.pending = undefined;
          await save(state);
        }
        throw error;
      });
    if (
      receipt.id !== file.fileId ||
      receipt.latestRevision.sizeBytes !== bytes.byteLength
    ) {
      throw new Error("The file receipt does not match the pending write.");
    }
    file.revision = receipt.latestRevision.revision;
    file.baseHash = pending.digest;
    file.sizeBytes = bytes.byteLength;
    file.pending = undefined;
    await save(state);
    // Only an acknowledged, durably recorded snapshot is disposable. Keep
    // unknown outcomes for reconciliation without accumulating every saved edit.
    await unlink(join(directory, `${pending.mutationId}.bin`));
  }

  return {
    async prepare(
      selection: SpaceWorkSelection,
      root: string,
      copyId: string = randomUUID()
    ) {
      const validated = spaceWorkSelectionSchema.parse(selection);
      await input.assertCurrentIdentity();
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const canonicalParent = await realpath(dirname(resolve(root)));
      const canonicalRoot = join(canonicalParent, basename(resolve(root)));
      // Never adopt or overwrite an occupied project.
      await mkdir(canonicalRoot, { mode: 0o700 });
      const identity = await lstat(canonicalRoot);
      const state: State = {
        schemaVersion: 1,
        copyId: z.uuid().parse(copyId),
        scope,
        root: canonicalRoot,
        rootDevice: identity.dev,
        rootInode: identity.ino,
        files: validated.files,
      };
      await save(state);
      try {
        return await owned(state.copyId, prepareFiles);
      } catch (error) {
        throw new Error(
          `Working copy ${state.copyId} is incomplete. Resume preparation with this copy ID; its files are preserved.`,
          { cause: error }
        );
      }
    },
    resume: (copyId: string) => owned(copyId, prepareFiles),
    status: (copyId: string) =>
      owned(copyId, async (state) => ({
        copyId,
        root: state.root,
        files: await Promise.all(
          state.files.map(async (file) => {
            const bytes = file.baseHash
              ? await localBytes(state, file.relativePath)
              : null;
            return {
              fileId: file.fileId,
              relativePath: file.relativePath,
              revision: file.revision,
              status: localStatus(file, bytes),
              ...(file.conflict?.incoming
                ? {
                    incomingRevision: file.conflict.incoming.revision,
                    incomingPath: file.conflict.incoming.relativePath,
                  }
                : {}),
            };
          })
        ),
      })),
    commit: (copyId: string) =>
      owned(copyId, async (state) => {
        if (state.files.some((file) => !(file.baseHash && file.mimeType))) {
          throw new Error(
            "Finish preparing all selected files before committing."
          );
        }
        // Reconcile unknown outcomes before freezing any new edits.
        for (const file of state.files) {
          await submitPending(state, file);
        }
        for (const file of state.files) {
          const bytes = await localBytes(state, file.relativePath);
          if (!bytes) {
            throw new Error(
              "A selected local file is missing. Missing files do not delete shared files."
            );
          }
          if (hash(bytes) === file.baseHash) {
            continue;
          }
          const mutationId = randomUUID();
          await writeDurablePrivateFile(
            join(directory, `${mutationId}.bin`),
            bytes
          );
          file.pending = {
            mutationId,
            digest: hash(bytes),
            baseRevision: file.revision,
          };
          await save(state);
          await submitPending(state, file);
        }
        return {
          copyId,
          references: await Promise.all(
            state.files.map(async (file) => {
              await input.assertCurrentIdentity();
              const current = await input.transport.get(file.fileId);
              return {
                fileId: file.fileId,
                revision: file.revision,
                name: current.name,
                mimeType: z.string().parse(file.mimeType),
                sizeBytes: z.number().int().nonnegative().parse(file.sizeBytes),
              };
            })
          ),
          files: state.files.map(({ fileId, relativePath, revision }) => ({
            fileId,
            relativePath,
            revision,
          })),
        };
      }),
    reconcile: (copyId: string) =>
      owned(copyId, async (state) => {
        for (const file of state.files) {
          await submitPending(state, file);
        }
        return { copyId, reconciled: true };
      }),
    refresh: (copyId: string) =>
      owned(copyId, async (state) => {
        for (const file of state.files) {
          if (!file.conflict || file.conflict.incoming) {
            continue;
          }
          await input.assertCurrentIdentity();
          const current = await input.transport.get(file.fileId);
          const revision = current.latestRevision.revision;
          const remote = await input.transport.read(file.fileId, revision);
          if (
            remote.revision !== revision ||
            remote.bytes.byteLength > SPACE_FILE_RAW_UPLOAD_MAX_BYTES
          ) {
            throw new Error(
              "The incoming file does not match its revision or exceeds transfer limits."
            );
          }
          const relativePath = `.openmeld-incoming-${randomUUID()}`;
          const path = await safePath(state, relativePath);
          const handle = await open(path, CREATE_FLAGS, 0o600);
          try {
            await handle.writeFile(remote.bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
          file.conflict.incoming = {
            revision,
            relativePath,
            digest: hash(remote.bytes),
            mimeType: remote.mimeType,
            sizeBytes: remote.bytes.byteLength,
          };
          await save(state);
        }
        return { copyId, refreshed: true };
      }),
    resolve: (copyId: string, fileId: string, revision: number) =>
      owned(copyId, async (state) => {
        const file = state.files.find((entry) => entry.fileId === fileId);
        const conflict = file?.conflict;
        const incoming = conflict?.incoming;
        if (!(file && incoming) || incoming.revision !== revision) {
          throw new Error(
            "Refresh this conflicted file and explicitly select the downloaded incoming revision."
          );
        }
        const bytes = await localBytes(state, file.relativePath);
        const digest = bytes ? hash(bytes) : null;
        if (
          !digest ||
          (digest === conflict.digest && digest !== incoming.digest)
        ) {
          throw new Error(
            "Merge the incoming version into the working file before resolving. The rejected edit cannot be resubmitted against a newer base unchanged."
          );
        }
        file.revision = revision;
        file.baseHash = incoming.digest;
        file.mimeType = incoming.mimeType;
        file.sizeBytes = incoming.sizeBytes;
        file.conflict = undefined;
        await save(state);
        // Keep both the rejected snapshot and incoming file as recovery evidence.
        return { copyId, resolved: true };
      }),
    incoming: (copyId: string, root: string) =>
      owned(copyId, async (state) => {
        const files: SpaceWorkSelection["files"] = [];
        for (const file of state.files) {
          await input.assertCurrentIdentity();
          const current = await input.transport.get(file.fileId);
          files.push({
            fileId: file.fileId,
            relativePath: file.relativePath,
            revision: current.latestRevision.revision,
          });
        }
        // Deliberate refresh: preserve the dirty/conflicted copy and its receipts.
        return await createSpaceWorkingCopies(input).prepare(
          { schemaVersion: 1, files },
          root
        );
      }),
  };
}

async function writeDurablePrivateFile(
  path: string,
  data: string | Uint8Array
) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function verifyRoot(state: State) {
  const root = await lstat(state.root);
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    root.dev !== state.rootDevice ||
    root.ino !== state.rootInode ||
    (await realpath(state.root)) !== state.root
  ) {
    throw new Error("The working directory changed. No files were submitted.");
  }
}

async function safePath(
  state: State,
  relativePath: string,
  createParents = false
) {
  await verifyRoot(state);
  const segments = spaceWorkRelativePathSchema.parse(relativePath).split("/");
  let parent = state.root;
  for (const segment of segments.slice(0, -1)) {
    parent = join(parent, segment);
    if (createParents) {
      try {
        await mkdir(parent, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }
    }
    const stat = await lstat(parent);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await realpath(parent)) !== parent
    ) {
      throw new Error(
        "A working file path crosses a symbolic link or changed directory."
      );
    }
  }
  return join(parent, segments.at(-1) ?? "");
}

async function localBytes(
  state: State,
  relativePath: string
): Promise<Buffer | null> {
  const path = await safePath(state, relativePath);
  let handle: FileHandle;
  try {
    handle = await open(path, READ_FLAGS);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > SPACE_FILE_RAW_UPLOAD_MAX_BYTES
    ) {
      throw new Error("Select a regular file up to 10 MiB without hard links.");
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset
      );
      if (result.bytesRead === 0) {
        throw new Error(
          "The local file changed while it was being read. Retry the save."
        );
      }
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    ) {
      throw new Error(
        "The local file changed while it was being read. Retry the save."
      );
    }
    await verifyRoot(state);
    return bytes;
  } finally {
    await handle.close();
  }
}

function localStatus(file: State["files"][number], bytes: Buffer | null) {
  if (file.conflict) {
    return "conflict";
  }
  if (file.pending) {
    return "pending";
  }
  if (!file.baseHash) {
    return "preparing";
  }
  if (!bytes) {
    return "missing";
  }
  return hash(bytes) === file.baseHash ? "clean" : "changed";
}
