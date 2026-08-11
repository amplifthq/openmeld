import type { z } from "zod/v4";

type SpaceAllowedActionsSchema =
  typeof import("../../schemas/space-mesh/publication-policy")["spaceAllowedActionsSchema"];
type SpaceAllowedActionSchema =
  typeof import("../../schemas/space-mesh/publication-policy")["spaceAllowedActionSchema"];
type SpacePublicationModeSchema =
  typeof import("../../schemas/space-mesh/publication-policy")["spacePublicationModeSchema"];

export type SpaceAllowedAction = z.infer<SpaceAllowedActionSchema>;
export type SpaceAllowedActions = z.infer<SpaceAllowedActionsSchema>;
export type SpacePublicationMode = z.infer<SpacePublicationModeSchema>;
