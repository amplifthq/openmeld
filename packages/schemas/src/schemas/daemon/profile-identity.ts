import * as z from "zod/v4";
import { MAX_VISITED_PROFILE_IDS } from "../protocol/constants";
import {
  openMeldRuntimeProfileIdSchema,
  profileHandleSchema,
  profileKindSchema,
  profileLabelSchema,
} from "../protocol/profile";

const nonEmptyTextSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, "Expected non-blank text");
const OPENMELD_SYSTEM_PROFILE_ID = "openmeld-system" as const;
const openMeldSystemProfileIdSchema = z.literal(OPENMELD_SYSTEM_PROFILE_ID);
const openMeldActorProfileIdSchema = z.union([
  openMeldRuntimeProfileIdSchema,
  openMeldSystemProfileIdSchema,
]);
const visitedProfileIdsSchema = z
  .array(openMeldRuntimeProfileIdSchema)
  .max(MAX_VISITED_PROFILE_IDS);

export const openMeldProfileIdSchema = openMeldRuntimeProfileIdSchema;

export const resolvedOpenMeldProfileSchema = z.strictObject({
  openMeldProfileId: openMeldProfileIdSchema,
  profileKind: profileKindSchema,
  profileName: profileLabelSchema,
  ownerUserId: nonEmptyTextSchema,
  profileHandle: profileHandleSchema.optional(),
  ownerName: profileLabelSchema.optional(),
  agentControllerRef: nonEmptyTextSchema.optional(),
  avatarUrl: z.string().min(1).optional(),
});

export const openMeldActorContextSchema = z
  .strictObject({
    requestId: nonEmptyTextSchema,
    callerPrincipalId: nonEmptyTextSchema.optional(),
    openMeldProfileId: openMeldActorProfileIdSchema,
    profileKind: profileKindSchema,
    profileHandle: profileHandleSchema.optional(),
    profileName: profileLabelSchema.optional(),
    ownerUserId: nonEmptyTextSchema.optional(),
    ownerName: profileLabelSchema.optional(),
    // Avatar travels with the actor context regardless of profile kind (humans
    // carry it too, unlike owner/ownerName which are agent-only downstream).
    avatarUrl: z.string().min(1).optional(),
    agentControllerRef: nonEmptyTextSchema.optional(),
    dispatchChainId: nonEmptyTextSchema.optional(),
    autoRelayDepth: z.number().int().nonnegative().optional(),
    visitedProfileIds: visitedProfileIdsSchema.optional(),
    visitedProfileIdsHash: nonEmptyTextSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.profileKind === "system") {
      if (value.openMeldProfileId !== OPENMELD_SYSTEM_PROFILE_ID) {
        ctx.addIssue({
          code: "custom",
          message:
            "system actor context must use openmeld-system as openMeldProfileId",
          path: ["openMeldProfileId"],
        });
      }
      return;
    }

    if (
      !openMeldRuntimeProfileIdSchema.safeParse(value.openMeldProfileId).success
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "human/agent actor context must use an auth-backed OpenMeld runtime profile ID",
        path: ["openMeldProfileId"],
      });
    }
  });

export const openMeldRequestContextSchema = z.strictObject({
  actorContext: openMeldActorContextSchema,
  activeOrganizationId: nonEmptyTextSchema.optional(),
  agentControllerConversationId: nonEmptyTextSchema.optional(),
});
