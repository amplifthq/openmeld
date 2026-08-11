import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  deviceOpenClawProfileBootstrapPath,
  deviceOpenClawProfileDir,
  deviceOpenClawProfileWorkspaceDir,
} from "../../config/paths";

const OPENCLAW_LOCAL_BOOTSTRAP_STATE_VERSION = 1;

type OpenClawLocalBootstrapStoreErrorCode =
  | "openclaw.bootstrap.state_invalid"
  | "openclaw.bootstrap.version_mismatch";

export type OpenClawLocalBootstrapState = {
  agentId: string;
  bootstrapVersion: number;
};

type OpenClawLocalBootstrapFile = OpenClawLocalBootstrapState & {
  v: 1;
};

type OpenClawLocalBootstrapParseResult =
  | {
      kind: "invalid";
    }
  | {
      actualVersion: number;
      kind: "version_mismatch";
    }
  | {
      kind: "ok";
      state: OpenClawLocalBootstrapState;
    };

export class OpenClawLocalBootstrapStoreError extends Error {
  readonly actualVersion?: number;
  readonly code: OpenClawLocalBootstrapStoreErrorCode;
  readonly expectedVersion?: number;
  readonly path: string;

  constructor(input: {
    actualVersion?: number;
    code: OpenClawLocalBootstrapStoreErrorCode;
    expectedVersion?: number;
    message: string;
    path: string;
  }) {
    super(input.message);
    this.actualVersion = input.actualVersion;
    this.code = input.code;
    this.expectedVersion = input.expectedVersion;
    this.name = "OpenClawLocalBootstrapStoreError";
    this.path = input.path;
  }
}

export function resolveOpenClawLocalBootstrapPaths(input: {
  openMeldProfileId: string;
}): {
  bootstrapPath: string;
  profileRoot: string;
  workspaceDir: string;
} {
  return {
    bootstrapPath: deviceOpenClawProfileBootstrapPath(input.openMeldProfileId),
    profileRoot: deviceOpenClawProfileDir(input.openMeldProfileId),
    workspaceDir: deviceOpenClawProfileWorkspaceDir(input.openMeldProfileId),
  };
}

export async function readOpenClawLocalBootstrapState(input: {
  openMeldProfileId: string;
}): Promise<OpenClawLocalBootstrapState | null> {
  const path = deviceOpenClawProfileBootstrapPath(input.openMeldProfileId);
  const raw = await readFile(path, "utf8").catch((error) => {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw buildInvalidBootstrapStateError(path);
  }
  const result = parseOpenClawLocalBootstrapFile(parsed);
  if (result.kind === "invalid") {
    throw buildInvalidBootstrapStateError(path);
  }
  if (result.kind === "version_mismatch") {
    throw buildBootstrapVersionMismatchError({
      actualVersion: result.actualVersion,
      path,
    });
  }
  return result.state;
}

export async function writeOpenClawLocalBootstrapState(input: {
  openMeldProfileId: string;
  state: OpenClawLocalBootstrapState;
}): Promise<void> {
  const path = deviceOpenClawProfileBootstrapPath(input.openMeldProfileId);
  await mkdir(dirname(path), { recursive: true });
  const payload: OpenClawLocalBootstrapFile = {
    v: OPENCLAW_LOCAL_BOOTSTRAP_STATE_VERSION,
    agentId: input.state.agentId,
    bootstrapVersion: input.state.bootstrapVersion,
  };
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function parseOpenClawLocalBootstrapFile(
  value: unknown
): OpenClawLocalBootstrapParseResult {
  if (!value || typeof value !== "object") {
    return { kind: "invalid" };
  }
  const parsed = value as {
    agentId?: unknown;
    bootstrapVersion?: unknown;
    v?: unknown;
  };
  const fileVersion =
    typeof parsed.v === "number" && Number.isInteger(parsed.v)
      ? parsed.v
      : null;
  const agentId = normalizeOptionalText(parsed.agentId);
  const bootstrapVersion =
    typeof parsed.bootstrapVersion === "number" &&
    Number.isInteger(parsed.bootstrapVersion) &&
    parsed.bootstrapVersion > 0
      ? parsed.bootstrapVersion
      : null;
  if (fileVersion === null) {
    return { kind: "invalid" };
  }
  if (fileVersion !== OPENCLAW_LOCAL_BOOTSTRAP_STATE_VERSION) {
    return {
      actualVersion: fileVersion,
      kind: "version_mismatch",
    };
  }
  if (!agentId || bootstrapVersion === null) {
    return { kind: "invalid" };
  }
  return {
    kind: "ok",
    state: {
      agentId,
      bootstrapVersion,
    },
  };
}

function buildInvalidBootstrapStateError(
  path: string
): OpenClawLocalBootstrapStoreError {
  return new OpenClawLocalBootstrapStoreError({
    code: "openclaw.bootstrap.state_invalid",
    message: `OpenClaw bootstrap state is invalid at '${path}'`,
    path,
  });
}

function buildBootstrapVersionMismatchError(input: {
  actualVersion: number;
  path: string;
}): OpenClawLocalBootstrapStoreError {
  return new OpenClawLocalBootstrapStoreError({
    actualVersion: input.actualVersion,
    code: "openclaw.bootstrap.version_mismatch",
    expectedVersion: OPENCLAW_LOCAL_BOOTSTRAP_STATE_VERSION,
    message: `OpenClaw bootstrap state version mismatch at '${input.path}': expected v${OPENCLAW_LOCAL_BOOTSTRAP_STATE_VERSION}, found v${input.actualVersion}`,
    path: input.path,
  });
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
