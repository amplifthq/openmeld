import * as z from "../../lazy-zod";
import { agentProfileIdSchema } from "../protocol/profile";
import {
  profileFolderIdSchema,
  profileFolderOperationReasonCodeSchema,
  profileFolderOperationSchema,
  profileFolderProjectionSchema,
} from "../protocol/profile-folders";
import { daemonServiceLaneSchema } from "./service-contract";

export const openMeldDaemonManageProfileFoldersRequestPayloadSchema =
  z.strictObject({
    targetProfileId: agentProfileIdSchema,
    operation: profileFolderOperationSchema,
  });

/**
 * The Service's folder-save receipt. It reports the resulting folder list as
 * a path-free projection; Core records exactly this projection.
 */
export const openMeldDaemonManageProfileFoldersPayloadSchema =
  z.discriminatedUnion("accepted", [
    z.strictObject({
      accepted: z.literal(true),
      targetProfileId: agentProfileIdSchema,
      status: z.literal("folders_applied"),
      folderId: profileFolderIdSchema.optional(),
      projection: profileFolderProjectionSchema,
    }),
    z.strictObject({
      accepted: z.literal(false),
      targetProfileId: agentProfileIdSchema,
      status: z.literal("rejected"),
      reasonCode: profileFolderOperationReasonCodeSchema,
      message: z.string().min(1),
    }),
  ]);

/** Core's per-computer record of one Profile's folders. No path field. */
export const profileFolderProjectionRecordSchema = z.strictObject({
  targetProfileId: agentProfileIdSchema,
  deviceId: z.string().min(1),
  lane: daemonServiceLaneSchema,
  observedAtMs: z.number().int().nonnegative(),
  projection: profileFolderProjectionSchema,
});
