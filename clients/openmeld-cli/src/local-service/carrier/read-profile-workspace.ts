import type { OpenMeldDaemonReadProfileWorkspacePayload } from "@openmeld/schemas/types";
import { resolveCurrentOpenMeldAccountContext } from "../../config/account-context";
import { readSavedProfileWorkspaceForAccount } from "../../profile-workspace/service";

/** A private read must use the account admitted for this socket session. */
export async function readLocalAgentProfileWorkspace(input: {
  ownerUserId: string;
  targetProfileId: string;
}): Promise<OpenMeldDaemonReadProfileWorkspacePayload> {
  const rejected = (
    reasonCode: string,
    message: string
  ): OpenMeldDaemonReadProfileWorkspacePayload => ({
    accepted: false,
    targetProfileId: input.targetProfileId,
    status: "rejected",
    reasonCode,
    message,
  });
  try {
    const account = await resolveCurrentOpenMeldAccountContext();
    if (
      account.source !== "session" ||
      account.user?.id !== input.ownerUserId
    ) {
      return rejected(
        "local_agent_control.account_mismatch",
        "The signed-in account changed. Reconnect this Computer before reading its working folder."
      );
    }
    const workspace = await readSavedProfileWorkspaceForAccount({
      account: account.key,
      openMeldProfileId: input.targetProfileId,
    });
    const current = await resolveCurrentOpenMeldAccountContext();
    if (
      current.source !== "session" ||
      current.user?.id !== input.ownerUserId ||
      current.key.hostKey !== account.key.hostKey ||
      current.key.userKey !== account.key.userKey
    ) {
      return rejected(
        "local_agent_control.account_mismatch",
        "The signed-in account changed while OpenMeld read the working folder. Reopen settings after reconnecting this Computer."
      );
    }
    return {
      accepted: true,
      status: "read",
      targetProfileId: input.targetProfileId,
      workspace,
    };
  } catch {
    // Filesystem errors can contain private paths. The authorized read returns
    // the saved path only in the typed successful configuration projection.
    return rejected(
      "profile.workspace.read_failed",
      "OpenMeld Service could not read the saved working-folder configuration."
    );
  }
}
