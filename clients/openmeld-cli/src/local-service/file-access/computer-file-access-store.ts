import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  computerFileAccessPolicyInputSchema,
  computerFileAccessPolicySchema,
} from "@openmeld/schemas";
import type {
  ComputerFileAccessErrorCode,
  ComputerFileAccessPolicy,
  ComputerFileAccessPolicyInput,
} from "@openmeld/schemas/types";
import { z } from "zod/v4";
import { DaemonServiceRunError } from "../core/types";

const LEGACY_COMPUTER_FILE_ACCESS_STORE_SCHEMA =
  "openmeld-computer-file-access-v1" as const;
const COMPUTER_FILE_ACCESS_STORE_SCHEMA =
  "openmeld-computer-file-access-v2" as const;
export const COMPUTER_FILE_ACCESS_IDEMPOTENCY_HISTORY_LIMIT = 64;

const idempotencyKeySchema = z.string().trim().min(1).max(512);

const legacyComputerFileAccessStoreSchema = z.strictObject({
  schema: z.literal(LEGACY_COMPUTER_FILE_ACCESS_STORE_SCHEMA),
  lastIdempotencyKey: idempotencyKeySchema.nullable(),
  policy: computerFileAccessPolicySchema,
});

const computerFileAccessIdempotencyRecordSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  result: computerFileAccessPolicySchema,
});

const computerFileAccessStoreSchema = z.strictObject({
  schema: z.literal(COMPUTER_FILE_ACCESS_STORE_SCHEMA),
  idempotencyHistory: z
    .array(computerFileAccessIdempotencyRecordSchema)
    .max(COMPUTER_FILE_ACCESS_IDEMPOTENCY_HISTORY_LIMIT),
  policy: computerFileAccessPolicySchema,
});

const DEFAULT_COMPUTER_FILE_ACCESS_POLICY = {
  mode: "local_agent_settings",
  revision: 1,
  updatedAtMs: 0,
} as const satisfies ComputerFileAccessPolicy;

const computerFileAccessStoreUpdateTails = new Map<string, Promise<void>>();

export function resolveComputerFileAccessStorePath(
  dataRootPath: string
): string {
  return join(dataRootPath, "computer-file-access-v1.json");
}

type ComputerFileAccessStoreDiagnosticContext =
  | {
      reason: "incompatible_schema" | "malformed_json";
      storePath: string;
    }
  | {
      errorCode: string | null;
      operation:
        | "canonicalize_folder"
        | "create_store_directory"
        | "inspect_folder"
        | "read_store"
        | "rename_store"
        | "verify_folder_access"
        | "write_store";
      path: string;
      reason: "io_error";
    };

export class ComputerFileAccessStoreError extends DaemonServiceRunError {
  readonly #localDiagnosticContext?: ComputerFileAccessStoreDiagnosticContext;
  declare readonly code: ComputerFileAccessErrorCode;

  constructor(
    code: ComputerFileAccessErrorCode,
    message: string,
    options?: {
      localDiagnosticContext?: ComputerFileAccessStoreDiagnosticContext;
    }
  ) {
    super({ code, message });
    this.#localDiagnosticContext = options?.localDiagnosticContext;
    this.code = code;
    this.name = "ComputerFileAccessStoreError";
  }

  get localDiagnosticContext() {
    return this.#localDiagnosticContext;
  }
}

export async function readComputerFileAccessPolicy(
  storePath: string
): Promise<ComputerFileAccessPolicy> {
  return (await readStore(storePath)).policy;
}

export async function updateComputerFileAccessPolicy(input: {
  expectedRevision: number;
  idempotencyKey: string;
  nowMs?: number;
  policy: ComputerFileAccessPolicyInput;
  storePath: string;
}): Promise<ComputerFileAccessPolicy> {
  const parsedInput = computerFileAccessPolicyInputSchema.safeParse(
    input.policy
  );
  if (!parsedInput.success) {
    throw new ComputerFileAccessStoreError(
      "computer.file_access.invalid_request",
      `Computer file access policy is invalid. ${parsedInput.error.issues[0]?.message ?? "Invalid policy."}`
    );
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new ComputerFileAccessStoreError(
      "computer.file_access.invalid_request",
      "The expected file access revision is invalid. Refresh and try again."
    );
  }
  const requestFingerprint = buildRequestFingerprint({
    expectedRevision: input.expectedRevision,
    policy: parsedInput.data,
  });
  return await serializeComputerFileAccessStoreUpdate(
    input.storePath,
    async () => {
      const current = await readStore(input.storePath);
      const previousResult = current.idempotencyHistory.find(
        (entry) => entry.idempotencyKey === input.idempotencyKey
      );
      if (previousResult) {
        if (previousResult.requestFingerprint !== requestFingerprint) {
          throw new ComputerFileAccessStoreError(
            "computer.file_access.invalid_request",
            "This file access request reused an idempotency key with different changes. Refresh and try again."
          );
        }
        return previousResult.result;
      }
      if (input.expectedRevision !== current.policy.revision) {
        throw new ComputerFileAccessStoreError(
          "computer.file_access.revision_mismatch",
          "File access changed on this computer. Refresh Computers and try again."
        );
      }

      const canonicalInput = await canonicalizePolicy(parsedInput.data);
      if (hasSamePolicyValue(current.policy, canonicalInput)) {
        await writeStore(input.storePath, {
          idempotencyHistory: appendIdempotencyRecord({
            current: current.idempotencyHistory,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint,
            result: current.policy,
          }),
          policy: current.policy,
          schema: COMPUTER_FILE_ACCESS_STORE_SCHEMA,
        });
        return current.policy;
      }
      const policy = computerFileAccessPolicySchema.parse({
        ...canonicalInput,
        revision: current.policy.revision + 1,
        updatedAtMs: input.nowMs ?? Date.now(),
      });
      await writeStore(input.storePath, {
        idempotencyHistory: appendIdempotencyRecord({
          current: current.idempotencyHistory,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
          result: policy,
        }),
        policy,
        schema: COMPUTER_FILE_ACCESS_STORE_SCHEMA,
      });
      return policy;
    }
  );
}

function buildRequestFingerprint(input: {
  expectedRevision: number;
  policy: ComputerFileAccessPolicyInput;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        expectedRevision: input.expectedRevision,
        policy: input.policy,
      })
    )
    .digest("hex");
}

function appendIdempotencyRecord(input: {
  current: z.infer<typeof computerFileAccessIdempotencyRecordSchema>[];
  idempotencyKey: string;
  requestFingerprint: string;
  result: ComputerFileAccessPolicy;
}) {
  return [
    ...input.current,
    {
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      result: input.result,
    },
  ].slice(-COMPUTER_FILE_ACCESS_IDEMPOTENCY_HISTORY_LIMIT);
}

async function serializeComputerFileAccessStoreUpdate<T>(
  storePath: string,
  update: () => Promise<T>
): Promise<T> {
  const previous =
    computerFileAccessStoreUpdateTails.get(storePath) ?? Promise.resolve();
  const result = previous.then(update);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  computerFileAccessStoreUpdateTails.set(storePath, tail);

  try {
    return await result;
  } finally {
    if (computerFileAccessStoreUpdateTails.get(storePath) === tail) {
      computerFileAccessStoreUpdateTails.delete(storePath);
    }
  }
}

async function canonicalizePolicy(
  policy: ComputerFileAccessPolicyInput
): Promise<ComputerFileAccessPolicyInput> {
  if (policy.mode === "local_agent_settings") {
    return policy;
  }
  const canonicalFolders = await Promise.all(
    policy.folders.map(canonicalizeFolder)
  );
  return {
    folders: removeRedundantFolders(canonicalFolders),
    mode: policy.mode,
  };
}

async function canonicalizeFolder(folder: string): Promise<string> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ComputerFileAccessStoreError(
        "computer.file_access.path_not_found",
        "OpenMeld couldn’t find that folder on this computer. Check the path and try again."
      );
    }
    throw computerFileAccessIoError({
      error,
      operation: "canonicalize_folder",
      path: folder,
    });
  }
  const metadata = await stat(canonicalPath).catch((error: unknown) => {
    throw computerFileAccessIoError({
      error,
      operation: "inspect_folder",
      path: canonicalPath,
    });
  });
  if (!metadata.isDirectory()) {
    throw new ComputerFileAccessStoreError(
      "computer.file_access.path_not_directory",
      "That path is not a folder. Enter a folder path."
    );
  }
  await access(canonicalPath, constants.R_OK).catch((error: unknown) => {
    throw new ComputerFileAccessStoreError(
      "computer.file_access.path_unreadable",
      "OpenMeld can’t read that folder. Check its permissions and try again.",
      {
        localDiagnosticContext: buildIoDiagnosticContext({
          error,
          operation: "verify_folder_access",
          path: canonicalPath,
        }),
      }
    );
  });
  return canonicalPath;
}

function removeRedundantFolders(folders: readonly string[]): string[] {
  const unique = [...new Set(folders)].sort((left, right) =>
    left.localeCompare(right)
  );
  return unique.filter(
    (candidate, index) =>
      !unique.some(
        (parent, parentIndex) =>
          parentIndex !== index && isPathInside(candidate, parent)
      )
  );
}

function isPathInside(candidate: string, parent: string): boolean {
  const relation = relative(parent, candidate);
  return (
    relation.length > 0 && !relation.startsWith("..") && !isAbsolute(relation)
  );
}

function hasSamePolicyValue(
  current: ComputerFileAccessPolicy,
  next: ComputerFileAccessPolicyInput
): boolean {
  if (current.mode !== next.mode) {
    return false;
  }
  if (current.mode === "local_agent_settings") {
    return true;
  }
  if (next.mode === "local_agent_settings") {
    return false;
  }
  return (
    current.folders.length === next.folders.length &&
    current.folders.every((folder, index) => folder === next.folders[index])
  );
}

async function readStore(storePath: string): Promise<{
  idempotencyHistory: z.infer<
    typeof computerFileAccessIdempotencyRecordSchema
  >[];
  policy: ComputerFileAccessPolicy;
}> {
  let raw: string;
  try {
    raw = await readFile(storePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        idempotencyHistory: [],
        policy: DEFAULT_COMPUTER_FILE_ACCESS_POLICY,
      };
    }
    throw computerFileAccessIoError({
      error,
      operation: "read_store",
      path: storePath,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw incompatibleStoreError(storePath, "malformed_json");
  }
  const parsed = computerFileAccessStoreSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  const legacy = legacyComputerFileAccessStoreSchema.safeParse(value);
  if (legacy.success) {
    return {
      idempotencyHistory: [],
      policy: legacy.data.policy,
    };
  }
  throw incompatibleStoreError(storePath, "incompatible_schema");
}

function incompatibleStoreError(
  storePath: string,
  reason: "incompatible_schema" | "malformed_json"
): Error {
  return new ComputerFileAccessStoreError(
    "computer.file_access.invalid_response",
    "Computer file access store is incompatible. Repair or update OpenMeld Service before trying again.",
    { localDiagnosticContext: { reason, storePath } }
  );
}

async function writeStore(
  storePath: string,
  value: z.infer<typeof computerFileAccessStoreSchema>
): Promise<void> {
  const storeDirectory = dirname(storePath);
  await mkdir(storeDirectory, { recursive: true }).catch((error: unknown) => {
    throw computerFileAccessIoError({
      error,
      operation: "create_store_directory",
      path: storeDirectory,
    });
  });
  const tempPath = `${storePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  }).catch((error: unknown) => {
    throw computerFileAccessIoError({
      error,
      operation: "write_store",
      path: tempPath,
    });
  });
  await rename(tempPath, storePath).catch(async (error) => {
    await unlink(tempPath).catch(() => undefined);
    throw computerFileAccessIoError({
      error,
      operation: "rename_store",
      path: storePath,
    });
  });
}

function computerFileAccessIoError(input: {
  error: unknown;
  operation: Extract<
    ComputerFileAccessStoreDiagnosticContext,
    { reason: "io_error" }
  >["operation"];
  path: string;
}): ComputerFileAccessStoreError {
  return new ComputerFileAccessStoreError(
    "computer.file_access.internal_error",
    "OpenMeld couldn’t access the Computer file access store. Try again or check OpenMeld Service diagnostics.",
    { localDiagnosticContext: buildIoDiagnosticContext(input) }
  );
}

function buildIoDiagnosticContext(input: {
  error: unknown;
  operation: Extract<
    ComputerFileAccessStoreDiagnosticContext,
    { reason: "io_error" }
  >["operation"];
  path: string;
}): Extract<ComputerFileAccessStoreDiagnosticContext, { reason: "io_error" }> {
  const errorCode =
    typeof input.error === "object" &&
    input.error !== null &&
    "code" in input.error &&
    typeof input.error.code === "string"
      ? input.error.code
      : null;
  return {
    errorCode,
    operation: input.operation,
    path: input.path,
    reason: "io_error",
  };
}
