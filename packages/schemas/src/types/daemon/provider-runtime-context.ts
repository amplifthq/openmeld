import type { z } from "zod/v4";

type ProviderDispatchRuntimeContextSchema =
  typeof import("../../schemas/daemon/provider-runtime-context")["providerDispatchRuntimeContextSchema"];

export type ProviderDispatchRuntimeContext =
  z.infer<ProviderDispatchRuntimeContextSchema>;
