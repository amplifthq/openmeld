import crypto from "node:crypto";
import type { ProfileKind } from "@openmeld/protocol";
import { normalizeOpenMeldProfileId } from "../config/paths";
import { setSessionOpenMeldProfileId } from "../config/session-profile";
import { resolveRuntimeContext } from "../runtime/context";
import { formatMessage } from "../runtime/messages";
import { createPresenter } from "../runtime/presenter/index";
import { toSlug } from "../ui/slug";

type RunInitInput = {
  profile?: string;
  profileId?: string;
  preserveProfileId?: boolean;
  profileName?: string;
  kind?: ProfileKind;
  agentName?: string;
  agentModel?: string;
  agentOwner?: string;
  silent?: boolean;
  view?: string;
  lastRuntimeMeta?: LastRuntimeMeta;
};

export type LastRuntimeMeta = {
  cliContextId: string;
  cliContextSource: string;
  updatedAt: string;
};

export type ProfileIdentityV1 = {
  v: 1;
  openMeldProfileId: string;
  profileName: string;
  kind: ProfileKind;
  agent?: {
    name?: string;
    model?: string;
    owner?: string;
  };
  createdAt: string;
  updatedAt: string;
  lastRuntimeMeta?: LastRuntimeMeta;
};

export async function runInit(
  input: RunInitInput
): Promise<{ openMeldProfileId: string; profileIdentity: ProfileIdentityV1 }> {
  const resolved = resolveInitProfile(input);
  await setSessionOpenMeldProfileId(resolved.openMeldProfileId);

  if (!input.silent) {
    await emitInitOutput({
      openMeldProfileId: resolved.openMeldProfileId,
      profileIdentity: resolved.profileIdentity,
      view: input.view,
    });
  }

  return resolved;
}

function resolveInitProfile(input: RunInitInput): {
  openMeldProfileId: string;
  profileIdentity: ProfileIdentityV1;
} {
  const explicitOpenMeldProfileId = normalizeOptionalString(input.profile);
  const explicitProfileName = normalizeOptionalString(input.profileName);
  const candidateProfileName = explicitOpenMeldProfileId
    ? (explicitProfileName ?? "")
    : (explicitProfileName ?? "anon");

  const profileIdSeed =
    input.preserveProfileId === false
      ? crypto.randomUUID()
      : (input.profileId ?? crypto.randomUUID());
  const candidateProfileId = normalizeOptionalString(profileIdSeed);
  const shortId = (candidateProfileId ?? crypto.randomUUID()).slice(0, 8);
  const openMeldProfileIdRaw =
    explicitOpenMeldProfileId || `${toSlug(candidateProfileName)}--${shortId}`;
  const openMeldProfileId = normalizeOpenMeldProfileId(openMeldProfileIdRaw);

  const profileIdentity: ProfileIdentityV1 = {
    v: 1,
    openMeldProfileId: candidateProfileId ?? crypto.randomUUID(),
    profileName: candidateProfileName || "Agent",
    kind: input.kind ?? "agent",
    ...resolveAgentPayload(input),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(input.lastRuntimeMeta
      ? { lastRuntimeMeta: input.lastRuntimeMeta }
      : {}),
  };

  return { openMeldProfileId, profileIdentity };
}

function resolveAgentPayload(input: RunInitInput): {
  agent?: {
    name?: string;
    model?: string;
    owner?: string;
  };
} {
  if (input.kind === "human" || input.kind === "system") {
    return {};
  }

  const name = normalizeOptionalString(input.agentName);
  const model = normalizeOptionalString(input.agentModel);
  const owner = normalizeOptionalString(input.agentOwner);
  if (!(name || model || owner)) {
    return {};
  }

  return {
    agent: {
      ...(name ? { name } : {}),
      ...(model ? { model } : {}),
      ...(owner ? { owner } : {}),
    },
  };
}

async function emitInitOutput(input: {
  openMeldProfileId: string;
  profileIdentity: ProfileIdentityV1;
  view?: string;
}): Promise<void> {
  const runtime = await resolveRuntimeContext({
    profile: input.openMeldProfileId,
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  presenter.line({
    code: "init.profile_initialized",
    text: formatMessage(runtime.resolvedView, "init.profile_initialized", {
      profile: input.openMeldProfileId,
    }),
    data: { profile: input.openMeldProfileId },
  });
  presenter.data({
    code: "init.profile",
    payload: input.profileIdentity,
  });
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
