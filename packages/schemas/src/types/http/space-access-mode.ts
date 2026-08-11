import type { z } from "zod/v4";

type SpaceAccessModeSchema =
  typeof import("../../schemas/http/space-access-mode")["spaceAccessModeSchema"];
type SetSpaceAccessModeBodySchema =
  typeof import("../../schemas/http/space-access-mode")["setSpaceAccessModeBodySchema"];
type SpaceAccessModeStateSchema =
  typeof import("../../schemas/http/space-access-mode")["spaceAccessModeStateSchema"];

export type SpaceAccessMode = z.infer<SpaceAccessModeSchema>;
export type SetSpaceAccessModeBody = z.infer<SetSpaceAccessModeBodySchema>;
export type SpaceAccessModeState = z.infer<SpaceAccessModeStateSchema>;
