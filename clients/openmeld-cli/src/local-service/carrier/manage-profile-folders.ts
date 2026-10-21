import type {
  OpenMeldDaemonManageProfileFoldersPayload,
  OpenMeldDaemonManageProfileFoldersRequestPayload,
  ProfileFolderOperationReasonCode,
} from "@openmeld/schemas/types";
import { resolveCurrentOpenMeldAccountContext } from "../../config/account-context";
import {
  applyProfileFolderOperation,
  ProfileFolderOperationError,
} from "../../profile-workspace/folders";

// Receipts travel to Core and can reach the Center Agent, so no message may
// carry a local path. Path failures use one fixed explanation.
const PATH_FREE_MESSAGES: Partial<
  Record<ProfileFolderOperationReasonCode, string>
> = {
  "profile_folder.path_invalid":
    "This folder is missing or can’t be used on this computer. Choose another folder.",
};

/** A folder change must use the account admitted for this socket session. */
export async function manageLocalProfileFolders(
  input: OpenMeldDaemonManageProfileFoldersRequestPayload & {
    ownerUserId: string;
  }
): Promise<OpenMeldDaemonManageProfileFoldersPayload> {
  const rejected = (
    reasonCode: ProfileFolderOperationReasonCode,
    message: string
  ): OpenMeldDaemonManageProfileFoldersPayload => ({
    accepted: false,
    targetProfileId: input.targetProfileId,
    status: "rejected",
    reasonCode,
    message: PATH_FREE_MESSAGES[reasonCode] ?? message,
  });
  try {
    const account = await resolveCurrentOpenMeldAccountContext();
    if (
      account.source !== "session" ||
      account.user?.id !== input.ownerUserId
    ) {
      return rejected(
        "profile_folder.operation_failed",
        "The signed-in account changed. Reconnect this Computer before changing its folders."
      );
    }
    const outcome = await applyProfileFolderOperation({
      account: account.key,
      openMeldProfileId: input.targetProfileId,
      operation: input.operation,
      ownerUserId: input.ownerUserId,
    });
    return {
      accepted: true,
      status: "folders_applied",
      targetProfileId: input.targetProfileId,
      ...(outcome.folderId ? { folderId: outcome.folderId } : {}),
      projection: outcome.projection,
    };
  } catch (error) {
    return buildProfileFolderRejection({
      error,
      targetProfileId: input.targetProfileId,
    });
  }
}

/** Maps a failed folder change to a receipt that carries no local path. */
export function buildProfileFolderRejection(input: {
  error: unknown;
  targetProfileId: string;
}): OpenMeldDaemonManageProfileFoldersPayload {
  if (input.error instanceof ProfileFolderOperationError) {
    return {
      accepted: false,
      targetProfileId: input.targetProfileId,
      status: "rejected",
      reasonCode: input.error.reasonCode,
      message:
        PATH_FREE_MESSAGES[input.error.reasonCode] ?? input.error.message,
    };
  }
  // Filesystem and lock errors can contain private paths.
  return {
    accepted: false,
    targetProfileId: input.targetProfileId,
    status: "rejected",
    reasonCode: "profile_folder.operation_failed",
    message:
      "OpenMeld Service couldn’t change this Agent’s folders. Try again.",
  };
}
