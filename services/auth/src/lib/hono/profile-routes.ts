import type {
  AuthProfileKind,
  OpenMeldProfileManagedRole,
} from "@openmeld/auth/server";
import { ProfileValidationError } from "@openmeld/auth/server";
import type { Context, Hono } from "hono";
import { refreshAuthSessionCookie } from "../better-auth/refresh-session-cookie";
import type { AppContext } from "../context";
import { requireTrustedCookieOrigin } from "../middlewares/trusted-origin";
import { reconcileDeletedAgentProfileMemberships } from "../profiles/deleted-profile-reconcile";
import { toProfileHttpErrorResponse } from "../profiles/profile-error-response";
import { toProfileView } from "../profiles/profile-view";
import { requireAuthenticatedUser } from "./authenticated-user";

type ResolveProfileRequestBody = {
  openMeldProfileId?: string;
  profileKind?: AuthProfileKind;
};

type CreateProfileRequestBody = {
  profileName: string;
  creatorProfileId?: string;
};

type CreateAgentProfileRequestBody = {
  profileName: string;
  creatorProfileId?: string;
};

type EnsureManagedAgentProfileRequestBody = {
  profileName: string;
  managedRole: OpenMeldProfileManagedRole;
  creatorProfileId?: string;
};

type UpdateProfileRequestBody = {
  profileName?: string;
};

const RESOLVE_PROFILE_REQUEST_BODY_KEYS = new Set([
  "openMeldProfileId",
  "profileKind",
]);
const PROFILE_NAME_REQUEST_BODY_KEYS = new Set([
  "profileName",
  "creatorProfileId",
]);
const AGENT_PROFILE_REQUEST_BODY_KEYS = new Set([
  "profileName",
  "creatorProfileId",
]);
const MANAGED_AGENT_PROFILE_REQUEST_BODY_KEYS = new Set([
  "profileName",
  "managedRole",
  "creatorProfileId",
]);
const PROFILE_PATCH_REQUEST_BODY_KEYS = new Set(["profileName"]);

export const PROFILE_ROUTE_BASE = "/v1/profiles";

export function registerProfileRoutes(app: Hono<AppContext>) {
  app.get(`${PROFILE_ROUTE_BASE}/capabilities`, (c) => {
    const authenticated = requireAuthenticatedUser(c);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    return c.json({
      ok: true,
      ...c.var.profileService.getProfileCapabilities(),
    });
  });

  app.get(PROFILE_ROUTE_BASE, async (c) => {
    const authenticated = requireAuthenticatedUser(c);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    try {
      const profiles =
        await c.var.profileService.listProfilesForOwnerEnsuringPrimaryHumanProfile(
          {
            ownerUserId: String(authenticated.user.id),
            userName: normalizeOptionalText(authenticated.user.name),
            userEmail: normalizeOptionalText(authenticated.user.email),
          }
        );
      const ownerName = normalizeOptionalText(authenticated.user.name);

      return c.json({
        ok: true,
        profiles: profiles.map((profile) =>
          toProfileView(profile, { ownerName })
        ),
      });
    } catch (error) {
      const failure = toProfileHttpErrorResponse(error);
      return c.json(failure.body, failure.status);
    }
  });

  app.post(`${PROFILE_ROUTE_BASE}/resolve`, async (c) => {
    const authenticated = requireAuthenticatedUser(c);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    try {
      const body = parseResolveProfileRequestBody(await readJsonBody(c));
      const profile = await c.var.profileService.resolveProfileForOwner({
        ownerUserId: String(authenticated.user.id),
        profileId: body.openMeldProfileId,
        profileKind: body.profileKind,
        fallbackUserName: String(authenticated.user.name ?? ""),
        fallbackUserEmail: String(authenticated.user.email ?? ""),
      });

      return c.json({
        ok: true,
        profile: toProfileView(profile, {
          ownerName: normalizeOptionalText(authenticated.user.name),
        }),
      });
    } catch (error) {
      const failure = toProfileHttpErrorResponse(error);
      return c.json(failure.body, failure.status);
    }
  });

  app.post(`${PROFILE_ROUTE_BASE}/agents`, async (c) => {
    const authenticated = requireAuthenticatedUser(c);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    try {
      const body = parseCreateAgentProfileRequestBody(await readJsonBody(c));
      const profile = await c.var.profileService.createAgentProfile({
        ownerUserId: String(authenticated.user.id),
        organizationId: requireActiveOrganizationId(c),
        createdByUserId: String(authenticated.user.id),
        creatorProfileId: body.creatorProfileId,
        profileName: body.profileName,
      });

      return c.json(
        {
          ok: true,
          profile: toProfileView(profile, {
            ownerName: normalizeOptionalText(authenticated.user.name),
          }),
        },
        201
      );
    } catch (error) {
      const failure = toProfileHttpErrorResponse(error);
      return c.json(failure.body, failure.status);
    }
  });

  app.post(`${PROFILE_ROUTE_BASE}/agents/managed/ensure`, async (c) => {
    const authenticated = requireAuthenticatedUser(c);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    try {
      const body = parseEnsureManagedAgentProfileRequestBody(
        await readJsonBody(c)
      );
      const profile = await c.var.profileService.ensureManagedAgentProfile({
        ownerUserId: String(authenticated.user.id),
        organizationId: requireActiveOrganizationId(c),
        createdByUserId: String(authenticated.user.id),
        creatorProfileId: body.creatorProfileId,
        managedRole: body.managedRole,
        profileName: body.profileName,
      });

      return c.json({
        ok: true,
        profile: toProfileView(profile, {
          ownerName: normalizeOptionalText(authenticated.user.name),
        }),
      });
    } catch (error) {
      const failure = toProfileHttpErrorResponse(error);
      return c.json(failure.body, failure.status);
    }
  });

  app.post(`${PROFILE_ROUTE_BASE}/humans`, async (c) => {
    const authenticated = requireAuthenticatedUser(c);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    try {
      const body = parseProfileNameRequestBody(await readJsonBody(c));
      const profile = await c.var.profileService.createHumanProfile({
        ownerUserId: String(authenticated.user.id),
        createdByUserId: String(authenticated.user.id),
        creatorProfileId: body.creatorProfileId,
        profileName: body.profileName,
      });

      return c.json(
        {
          ok: true,
          profile: toProfileView(profile, {
            ownerName: normalizeOptionalText(authenticated.user.name),
          }),
        },
        201
      );
    } catch (error) {
      const failure = toProfileHttpErrorResponse(error);
      return c.json(failure.body, failure.status);
    }
  });

  app.patch(
    `${PROFILE_ROUTE_BASE}/:openMeldProfileId`,
    requireTrustedCookieOrigin,
    async (c) => {
      const authenticated = requireAuthenticatedUser(c);
      if (!authenticated.ok) {
        return authenticated.response;
      }

      const openMeldProfileId = c.req.param("openMeldProfileId");
      try {
        const body = parseProfilePatchRequestBody(await readJsonBody(c));
        const profile = await c.var.profileService.updateProfileForOwner({
          ownerUserId: String(authenticated.user.id),
          profileId: openMeldProfileId,
          ...(body.profileName ? { profileName: body.profileName } : {}),
        });
        if (profile.profileKind === "human" && profile.isDefault) {
          await refreshAuthSessionCookie(c);
        }

        return c.json({
          ok: true,
          profile: toProfileView(profile, {
            ownerName:
              profile.profileKind === "human" && profile.isDefault
                ? profile.profileName
                : normalizeOptionalText(authenticated.user.name),
          }),
        });
      } catch (error) {
        const failure = toProfileHttpErrorResponse(error);
        return c.json(failure.body, failure.status);
      }
    }
  );

  app.delete(`${PROFILE_ROUTE_BASE}/:openMeldProfileId`, async (c) => {
    const authenticated = requireAuthenticatedUser(c);
    if (!authenticated.ok) {
      return authenticated.response;
    }

    const openMeldProfileId = c.req.param("openMeldProfileId");

    try {
      const profile = await c.var.profileService.deleteProfileForOwner({
        ownerUserId: String(authenticated.user.id),
        profileId: openMeldProfileId,
      });
      await reconcileDeletedAgentProfileMemberships(c.env, profile);

      return c.json({
        ok: true,
        profile: toProfileView(profile, {
          ownerName: normalizeOptionalText(authenticated.user.name),
        }),
      });
    } catch (error) {
      const failure = toProfileHttpErrorResponse(error);
      return c.json(failure.body, failure.status);
    }
  });
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function readJsonBody(c: Context<AppContext>): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ProfileValidationError("request body must be valid JSON");
  }
}

function parseResolveProfileRequestBody(
  value: unknown
): ResolveProfileRequestBody {
  const record = parseStrictObject(
    value,
    RESOLVE_PROFILE_REQUEST_BODY_KEYS,
    "resolve profile request body"
  );
  const openMeldProfileId = readOptionalNonEmptyString(
    record,
    "openMeldProfileId"
  );
  const profileKind = readOptionalProfileKind(record, "profileKind");

  return {
    ...(openMeldProfileId ? { openMeldProfileId } : {}),
    ...(profileKind ? { profileKind } : {}),
  };
}

function parseProfileNameRequestBody(value: unknown): CreateProfileRequestBody {
  const record = parseStrictObject(
    value,
    PROFILE_NAME_REQUEST_BODY_KEYS,
    "profile request body"
  );
  const creatorProfileId = readOptionalNonEmptyString(
    record,
    "creatorProfileId"
  );
  return {
    profileName: readRequiredNonEmptyString(record, "profileName"),
    ...(creatorProfileId ? { creatorProfileId } : {}),
  };
}

function parseCreateAgentProfileRequestBody(
  value: unknown
): CreateAgentProfileRequestBody {
  const record = parseStrictObject(
    value,
    AGENT_PROFILE_REQUEST_BODY_KEYS,
    "agent profile request body"
  );
  const creatorProfileId = readOptionalNonEmptyString(
    record,
    "creatorProfileId"
  );
  return {
    profileName: readRequiredNonEmptyString(record, "profileName"),
    ...(creatorProfileId ? { creatorProfileId } : {}),
  };
}

function parseEnsureManagedAgentProfileRequestBody(
  value: unknown
): EnsureManagedAgentProfileRequestBody {
  const record = parseStrictObject(
    value,
    MANAGED_AGENT_PROFILE_REQUEST_BODY_KEYS,
    "managed agent profile request body"
  );
  const creatorProfileId = readOptionalNonEmptyString(
    record,
    "creatorProfileId"
  );
  return {
    profileName: readRequiredNonEmptyString(record, "profileName"),
    managedRole: readManagedRole(record, "managedRole"),
    ...(creatorProfileId ? { creatorProfileId } : {}),
  };
}

function parseProfilePatchRequestBody(
  value: unknown
): UpdateProfileRequestBody {
  const record = parseStrictObject(
    value,
    PROFILE_PATCH_REQUEST_BODY_KEYS,
    "profile patch request body"
  );
  const profileName = readOptionalNonEmptyString(record, "profileName");
  if (!profileName) {
    throw new ProfileValidationError("profileName is required");
  }
  return {
    ...(profileName ? { profileName } : {}),
  };
}

function parseStrictObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  field: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProfileValidationError(`${field} must be a JSON object`);
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new ProfileValidationError(`unexpected field in ${field}: ${key}`);
    }
  }
  return record;
}

function readRequiredNonEmptyString(
  input: Record<string, unknown>,
  field: string
): string {
  const value = readOptionalNonEmptyString(input, field);
  if (!value) {
    throw new ProfileValidationError(`${field} is required`);
  }
  return value;
}

function readOptionalNonEmptyString(
  input: Record<string, unknown>,
  field: string
): string | null {
  const value = input[field];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ProfileValidationError(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ProfileValidationError(`${field} must be a non-empty string`);
  }
  return normalized;
}

function readManagedRole(
  input: Record<string, unknown>,
  field: string
): OpenMeldProfileManagedRole {
  const value = readRequiredNonEmptyString(input, field);
  if (value === "openmeld_assistant") {
    return value;
  }
  throw new ProfileValidationError(`${field} is invalid`);
}

function readOptionalProfileKind(
  input: Record<string, unknown>,
  field: string
): AuthProfileKind | null {
  const value = input[field];
  if (value === undefined) {
    return null;
  }
  if (value === "human" || value === "agent" || value === "system") {
    return value;
  }
  throw new ProfileValidationError(
    `${field} must be one of human|agent|system`
  );
}

function requireActiveOrganizationId(c: Context<AppContext>): string {
  const activeOrganizationId = normalizeOptionalText(
    (c.var.session as { activeOrganizationId?: unknown } | null)
      ?.activeOrganizationId
  );
  if (!activeOrganizationId) {
    throw new ProfileValidationError("active organization is required");
  }
  return activeOrganizationId;
}
