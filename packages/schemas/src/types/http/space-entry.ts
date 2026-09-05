import type { z } from "zod/v4";

type GetSpaceEntryResolutionInputSchema =
  typeof import("../../schemas/http/space-entry")["getSpaceEntryResolutionInputSchema"];
type GetSpaceEntryResolutionResponseSchema =
  typeof import("../../schemas/http/space-entry")["getSpaceEntryResolutionResponseSchema"];
type SpaceEntryOwnerSchema =
  typeof import("../../schemas/http/space-entry")["spaceEntryOwnerSchema"];
type SpaceEntryParticipationSchema =
  typeof import("../../schemas/http/space-entry")["spaceEntryParticipationSchema"];
type SpaceEntryRecoverySchema =
  typeof import("../../schemas/http/space-entry")["spaceEntryRecoverySchema"];
type SpaceEntrySafeContextSchema =
  typeof import("../../schemas/http/space-entry")["spaceEntrySafeContextSchema"];
type SpaceEntryTargetSchema =
  typeof import("../../schemas/http/space-entry")["spaceEntryTargetSchema"];
type SpaceEntryViewSchema =
  typeof import("../../schemas/http/space-entry")["spaceEntryViewSchema"];

export type GetSpaceEntryResolutionInput =
  z.infer<GetSpaceEntryResolutionInputSchema>;
export type GetSpaceEntryResolutionResponse =
  z.infer<GetSpaceEntryResolutionResponseSchema>;
export type SpaceEntryOwner = z.infer<SpaceEntryOwnerSchema>;
export type SpaceEntryParticipation = z.infer<SpaceEntryParticipationSchema>;
export type SpaceEntryRecovery = z.infer<SpaceEntryRecoverySchema>;
export type SpaceEntrySafeContext = z.infer<SpaceEntrySafeContextSchema>;
export type SpaceEntryTarget = z.infer<SpaceEntryTargetSchema>;
export type SpaceEntryView = z.infer<SpaceEntryViewSchema>;
