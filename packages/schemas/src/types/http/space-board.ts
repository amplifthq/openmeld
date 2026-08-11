import type { z } from "zod/v4";

type GetSpaceBoardInputSchema =
  typeof import("../../schemas/http/space-board")["getSpaceBoardInputSchema"];
type SpaceBoardAgentProfileSchema =
  typeof import("../../schemas/http/space-board")["spaceBoardAgentProfileSchema"];
type SpaceBoardMembersSchema =
  typeof import("../../schemas/http/space-board")["spaceBoardMembersSchema"];
type SpaceBoardOutcomeSchema =
  typeof import("../../schemas/http/space-board")["spaceBoardOutcomeSchema"];
type SpaceBoardRecentOutcomeSchema =
  typeof import("../../schemas/http/space-board")["spaceBoardRecentOutcomeSchema"];
type SpaceBoardResponseSchema =
  typeof import("../../schemas/http/space-board")["spaceBoardResponseSchema"];
type SpaceBoardRoomProjectionSchema =
  typeof import("../../schemas/http/space-board")["spaceBoardRoomProjectionSchema"];
type SpaceBoardSpaceSchema =
  typeof import("../../schemas/http/space-board")["spaceBoardSpaceSchema"];
type SpaceBoardWorkingExecutionSchema =
  typeof import("../../schemas/http/space-board")["spaceBoardWorkingExecutionSchema"];

export type GetSpaceBoardInput = z.infer<GetSpaceBoardInputSchema>;
export type SpaceBoardAgentProfile = z.infer<SpaceBoardAgentProfileSchema>;
export type SpaceBoardMembers = z.infer<SpaceBoardMembersSchema>;
export type SpaceBoardOutcome = z.infer<SpaceBoardOutcomeSchema>;
export type SpaceBoardRecentOutcome = z.infer<SpaceBoardRecentOutcomeSchema>;
export type SpaceBoardResponse = z.infer<SpaceBoardResponseSchema>;
export type SpaceBoardRoomProjection = z.infer<SpaceBoardRoomProjectionSchema>;
export type SpaceBoardSpace = z.infer<SpaceBoardSpaceSchema>;
export type SpaceBoardWorkingExecution =
  z.infer<SpaceBoardWorkingExecutionSchema>;
