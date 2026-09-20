import type { z } from "zod/v4";

type HostedCenterAgentRuntimeIdentitySchema =
  typeof import("../../schemas/runtime/hosted-runtime")["hostedCenterAgentRuntimeIdentitySchema"];

export type HostedCenterAgentRuntimeIdentity =
  z.infer<HostedCenterAgentRuntimeIdentitySchema>;

export type HostedAgentRuntimeIdentity = z.infer<
  typeof import("../../schemas/runtime/hosted-runtime")["hostedAgentRuntimeIdentitySchema"]
>;
