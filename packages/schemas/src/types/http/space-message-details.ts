import type { z } from "zod/v4";

type SpaceMessageDetailsFactStateSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsFactStateSchema"];
type SpaceMessageDetailsFactSourceSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsFactSourceSchema"];
type SpaceMessageDetailsStringFactSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsStringFactSchema"];
type SpaceMessageDetailsSectionStateSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsSectionStateSchema"];
type SpaceMessageDetailsSignalTypeSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsSignalTypeSchema"];
type SpaceMessageDetailsActorSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsActorSchema"];
type SpaceMessageDetailsMessageSectionSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsMessageSectionSchema"];
type SpaceMessageDetailsAgentContextSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsAgentContextSchema"];
type SpaceMessageDetailsWakeTargetSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsWakeTargetSchema"];
type SpaceMessageDetailsWakeContextSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsWakeContextSchema"];
type SpaceMessageDetailsReplyContextSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsReplyContextSchema"];
type SpaceMessageDetailsToolActivitySchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsToolActivitySchema"];
type SpaceMessageDetailsWorkingDetailsSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsWorkingDetailsSchema"];
type SpaceMessageDetailsTraceSelectorSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsTraceSelectorSchema"];
type SpaceMessageDetailsDiagnosticsSchema =
  typeof import("../../schemas/http/space-message-details")["spaceMessageDetailsDiagnosticsSchema"];
type GetSpaceMessageDetailsInputSchema =
  typeof import("../../schemas/http/space-message-details")["getSpaceMessageDetailsInputSchema"];
type GetSpaceMessageDetailsResponseSchema =
  typeof import("../../schemas/http/space-message-details")["getSpaceMessageDetailsResponseSchema"];

export type SpaceMessageDetailsFactState =
  z.infer<SpaceMessageDetailsFactStateSchema>;
export type SpaceMessageDetailsFactSource =
  z.infer<SpaceMessageDetailsFactSourceSchema>;
export type SpaceMessageDetailsStringFact =
  z.infer<SpaceMessageDetailsStringFactSchema>;
export type SpaceMessageDetailsSectionState =
  z.infer<SpaceMessageDetailsSectionStateSchema>;
export type SpaceMessageDetailsSignalType =
  z.infer<SpaceMessageDetailsSignalTypeSchema>;
export type SpaceMessageDetailsActor = z.infer<SpaceMessageDetailsActorSchema>;
export type SpaceMessageDetailsMessageSection =
  z.infer<SpaceMessageDetailsMessageSectionSchema>;
export type SpaceMessageDetailsAgentContext =
  z.infer<SpaceMessageDetailsAgentContextSchema>;
export type SpaceMessageDetailsWakeTarget =
  z.infer<SpaceMessageDetailsWakeTargetSchema>;
export type SpaceMessageDetailsWakeContext =
  z.infer<SpaceMessageDetailsWakeContextSchema>;
export type SpaceMessageDetailsReplyContext =
  z.infer<SpaceMessageDetailsReplyContextSchema>;
export type SpaceMessageDetailsToolActivity =
  z.infer<SpaceMessageDetailsToolActivitySchema>;
export type SpaceMessageDetailsWorkingDetails =
  z.infer<SpaceMessageDetailsWorkingDetailsSchema>;
export type SpaceMessageDetailsTraceSelector =
  z.infer<SpaceMessageDetailsTraceSelectorSchema>;
export type SpaceMessageDetailsDiagnostics =
  z.infer<SpaceMessageDetailsDiagnosticsSchema>;
export type GetSpaceMessageDetailsInput =
  z.infer<GetSpaceMessageDetailsInputSchema>;
export type GetSpaceMessageDetailsResponse =
  z.infer<GetSpaceMessageDetailsResponseSchema>;
