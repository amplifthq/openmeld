import type { z } from "zod/v4";

type SpaceDispatchPolicyModeSchema =
  typeof import("../../schemas/space-mesh/dispatch-policy")["spaceDispatchPolicyModeSchema"];
type SpaceDispatchPolicySchema =
  typeof import("../../schemas/space-mesh/dispatch-policy")["spaceDispatchPolicySchema"];

export type SpaceDispatchPolicyMode = z.infer<SpaceDispatchPolicyModeSchema>;
export type SpaceDispatchPolicy = z.infer<SpaceDispatchPolicySchema>;
