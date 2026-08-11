import { providerDispatchRuntimeContextSchema } from "@openmeld/schemas";
import {
  readProfileWorkspaceConfigForAccount,
  resolveConfiguredProfileWorkspacePathForAccount,
} from "../profile-workspace/service";
import { resolveCurrentOpenMeldAccountContext } from "./account-context";
import { normalizeOpenMeldProfileId, type OpenMeldAccountKey } from "./paths";

export type ProfileLocalMeta = {
  openMeldProfileId: string;
  providerRuntimeWorkingDirectory: string;
  updatedAt: string;
  v: 1;
};

type SafeParseResult<T> = { success: true; data: T } | { success: false };

export const profileLocalMetaSchema = {
  safeParse(value: unknown): SafeParseResult<ProfileLocalMeta> {
    if (!(value && typeof value === "object")) {
      return { success: false };
    }
    const record = value as Record<string, unknown>;
    if (record.v !== 1) {
      return { success: false };
    }

    const openMeldProfileId = normalizeNonEmptyString(record.openMeldProfileId);
    const updatedAt = normalizeTimestamp(record.updatedAt);
    const providerRuntimeWorkingDirectory =
      normalizeProviderRuntimeWorkingDirectory(
        record.providerRuntimeWorkingDirectory
      );
    if (
      !(
        openMeldProfileId &&
        updatedAt &&
        providerRuntimeWorkingDirectory &&
        hasOnlyExpectedKeys(record)
      )
    ) {
      return { success: false };
    }

    return {
      success: true,
      data: {
        openMeldProfileId,
        providerRuntimeWorkingDirectory,
        updatedAt,
        v: 1,
      },
    };
  },
};

export type ProfileLocalMetaReadResult =
  | {
      path: string;
      status: "missing";
    }
  | {
      path: string;
      status: "invalid";
      reason: "invalid_json" | "invalid_schema" | "profile_id_mismatch";
    }
  | {
      path: string;
      status: "valid";
      value: ProfileLocalMeta;
    };

export async function readProfileLocalMeta(
  openMeldProfileId: string
): Promise<ProfileLocalMetaReadResult> {
  const normalizedOpenMeldProfileId =
    normalizeOpenMeldProfileId(openMeldProfileId);
  const accountContext = await resolveCurrentOpenMeldAccountContext();
  return readProfileLocalMetaForAccount({
    account: accountContext.key,
    openMeldProfileId: normalizedOpenMeldProfileId,
  });
}

export async function readProfileLocalMetaForAccount(input: {
  account: OpenMeldAccountKey;
  openMeldProfileId: string;
}): Promise<ProfileLocalMetaReadResult> {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const workspaceConfig = await readProfileWorkspaceConfigForAccount({
    account: input.account,
    openMeldProfileId,
  });
  if (workspaceConfig.status !== "valid") {
    return workspaceConfig;
  }

  const providerRuntimeWorkingDirectory =
    resolveConfiguredProfileWorkspacePathForAccount({
      account: input.account,
      openMeldProfileId,
      value: workspaceConfig.value,
    });

  return {
    path: workspaceConfig.path,
    status: "valid",
    value: {
      openMeldProfileId,
      providerRuntimeWorkingDirectory,
      updatedAt: workspaceConfig.updatedAt,
      v: 1,
    },
  };
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTimestamp(value: unknown): string | null {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    return null;
  }
  return normalized;
}

function normalizeProviderRuntimeWorkingDirectory(
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = providerDispatchRuntimeContextSchema.safeParse({
    providerRuntimeWorkingDirectory: value,
  });
  return parsed.success ? parsed.data.providerRuntimeWorkingDirectory : null;
}

function hasOnlyExpectedKeys(record: Record<string, unknown>): boolean {
  const expectedKeys = new Set([
    "v",
    "openMeldProfileId",
    "providerRuntimeWorkingDirectory",
    "updatedAt",
  ]);
  return Object.keys(record).every((key) => expectedKeys.has(key));
}
