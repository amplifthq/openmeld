import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveCurrentOpenMeldAccountContext } from "./account-context";
import {
  accountProfileViewPath,
  normalizeOpenMeldProfileId,
  type OpenMeldProfileId,
} from "./paths";

export type ProfileDefaultView = "auto" | "human" | "agent";

type ProfileViewV1 = {
  v: 1;
  openMeldProfileId: OpenMeldProfileId;
  defaultView: Exclude<ProfileDefaultView, "auto">;
  updatedAt: string;
};

type StoredProfileViewInput = Partial<ProfileViewV1> & { profile?: string };

type NormalizedStoredProfileView = {
  needsRewrite: boolean;
  payload: ProfileViewV1;
};

export async function getProfileDefaultView(
  openMeldProfileId: string
): Promise<ProfileDefaultView> {
  const normalizedOpenMeldProfileId =
    normalizeOpenMeldProfileId(openMeldProfileId);
  const path = await resolveAccountProfileViewPath(normalizedOpenMeldProfileId);
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) {
    return "auto";
  }

  try {
    const parsed = JSON.parse(raw) as StoredProfileViewInput;
    if (parsed.v !== 1) {
      return "auto";
    }
    const normalizedStoredProfileView = normalizeStoredProfileView(parsed);
    if (!normalizedStoredProfileView) {
      return "auto";
    }
    if (
      normalizedStoredProfileView.payload.openMeldProfileId !==
      normalizedOpenMeldProfileId
    ) {
      await rm(path, { force: true });
      return "auto";
    }
    if (normalizedStoredProfileView.needsRewrite) {
      await writeProfileViewFile(path, normalizedStoredProfileView.payload);
    }
    return normalizedStoredProfileView.payload.defaultView;
  } catch {
    return "auto";
  }
}

export async function setProfileDefaultView(input: {
  openMeldProfileId: string;
  view: ProfileDefaultView;
}): Promise<void> {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const path = await resolveAccountProfileViewPath(openMeldProfileId);

  if (input.view === "auto") {
    await rm(path, { force: true });
    return;
  }

  await writeProfileViewFile(path, {
    v: 1,
    openMeldProfileId,
    defaultView: input.view,
    updatedAt: new Date().toISOString(),
  });
}

async function writeProfileViewFile(
  path: string,
  payload: ProfileViewV1
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function resolveAccountProfileViewPath(
  openMeldProfileId: OpenMeldProfileId
): Promise<string> {
  const accountContext = await resolveCurrentOpenMeldAccountContext();
  return accountProfileViewPath(accountContext.key, openMeldProfileId);
}

function normalizeStoredProfileView(
  input: StoredProfileViewInput
): NormalizedStoredProfileView | null {
  const openMeldProfileId = normalizeOptionalOpenMeldProfileId(
    input.openMeldProfileId
  );
  const legacyProfile = normalizeOptionalOpenMeldProfileId(input.profile);
  const resolvedOpenMeldProfileId = openMeldProfileId ?? legacyProfile;
  if (!resolvedOpenMeldProfileId) {
    return null;
  }
  const defaultView = normalizeStoredDefaultView(input.defaultView);
  if (!defaultView) {
    return null;
  }
  const updatedAt = normalizeStoredUpdatedAt(input.updatedAt);
  return {
    needsRewrite:
      openMeldProfileId !== resolvedOpenMeldProfileId ||
      input.profile !== undefined ||
      input.updatedAt !== updatedAt,
    payload: {
      v: 1,
      openMeldProfileId: resolvedOpenMeldProfileId,
      defaultView,
      updatedAt,
    },
  };
}

function normalizeStoredDefaultView(
  value: unknown
): Exclude<ProfileDefaultView, "auto"> | null {
  if (value === "human" || value === "agent") {
    return value;
  }
  return null;
}

function normalizeStoredUpdatedAt(value: unknown): string {
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (trimmedValue.length > 0 && !Number.isNaN(Date.parse(trimmedValue))) {
      return trimmedValue;
    }
  }
  return new Date().toISOString();
}

function normalizeOptionalOpenMeldProfileId(
  value: unknown
): OpenMeldProfileId | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return normalizeOpenMeldProfileId(value);
  } catch {
    return null;
  }
}
