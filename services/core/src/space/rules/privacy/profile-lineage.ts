import type { CoreBindings } from "../../../lib/bindings";

export type CreatorProfileIdsByProfileId = Record<string, string | null>;

export async function loadCreatorProfileIdsByOwnerUserId(input: {
  authRpc?: CoreBindings["OPENMELD_AUTH_WORKER"];
  ownerUserId?: string;
  onError?: (error: unknown, ownerUserId: string) => void;
}): Promise<CreatorProfileIdsByProfileId | undefined> {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) {
    return undefined;
  }

  const authRpc = input.authRpc;
  if (!authRpc?.listProfileLineage) {
    return undefined;
  }

  try {
    const result = await authRpc.listProfileLineage({
      ownerUserId,
    });
    if (!result.ok) {
      return undefined;
    }

    return Object.fromEntries(
      result.profiles.map((profile) => [
        profile.profileId,
        normalizeOptionalText(profile.creatorProfileId),
      ])
    ) as CreatorProfileIdsByProfileId;
  } catch (error) {
    input.onError?.(error, ownerUserId);
    return undefined;
  }
}

export async function resolveViewerCreatorProfileIdsByProfileId(input: {
  authRpc?: CoreBindings["OPENMELD_AUTH_WORKER"];
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  onError?: (error: unknown, ownerUserId: string) => void;
}): Promise<CreatorProfileIdsByProfileId | undefined> {
  const viewerOwnerUserId = normalizeOptionalText(input.viewerOwnerUserId);
  const viewerProfileId = normalizeOptionalText(input.viewerProfileId);
  if (!(viewerOwnerUserId && viewerProfileId)) {
    return undefined;
  }

  return await loadCreatorProfileIdsByOwnerUserId({
    authRpc: input.authRpc,
    ownerUserId: viewerOwnerUserId,
    onError: input.onError,
  });
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
