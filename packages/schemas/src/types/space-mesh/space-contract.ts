import type { z } from "zod/v4";

type SpaceBriefModeSchema =
  typeof import("../../schemas/space-mesh/space-contract")["spaceBriefModeSchema"];
type SpaceContractFieldsSchema =
  typeof import("../../schemas/space-mesh/space-contract")["spaceContractFieldsSchema"];
type SpaceContractSchema =
  typeof import("../../schemas/space-mesh/space-contract")["spaceContractSchema"];

export type SpaceBriefMode = z.infer<SpaceBriefModeSchema>;
export type SpaceContractFields = z.infer<SpaceContractFieldsSchema>;
export type SpaceContract = z.infer<SpaceContractSchema>;
