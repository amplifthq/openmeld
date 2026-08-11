import type { z } from "zod/v4";

type DispatchResultKindSchema =
  typeof import("../../schemas/space-mesh/dispatch-result")["dispatchResultKindSchema"];
type DispatchResultPublicOutcomeSchema =
  typeof import("../../schemas/space-mesh/dispatch-result")["dispatchResultPublicOutcomeSchema"];
type DispatchResultSchema =
  typeof import("../../schemas/space-mesh/dispatch-result")["dispatchResultSchema"];

export type DispatchResultKind = z.infer<DispatchResultKindSchema>;
export type DispatchResultPublicOutcome =
  z.infer<DispatchResultPublicOutcomeSchema>;
export type DispatchResult = z.infer<DispatchResultSchema>;
