import type { z } from "zod/v4";

type OpenConnectorRuntimeActionExecutionSchema =
  typeof import("../../schemas/runtime/openconnector-runtime")["openConnectorRuntimeActionExecutionSchema"];
type OpenConnectorRuntimeActionEffectSchema =
  typeof import("../../schemas/runtime/openconnector-runtime")["openConnectorRuntimeActionEffectSchema"];
type OpenConnectorRuntimeActionSchema =
  typeof import("../../schemas/runtime/openconnector-runtime")["openConnectorRuntimeActionSchema"];
type OpenConnectorRuntimeActionOperationMetaSchema =
  typeof import("../../schemas/runtime/openconnector-runtime")["openConnectorRuntimeActionOperationMetaSchema"];
type OpenConnectorRuntimeActionSearchResultSchema =
  typeof import("../../schemas/runtime/openconnector-runtime")["openConnectorRuntimeActionSearchResultSchema"];

export type OpenConnectorRuntimeActionExecution =
  z.infer<OpenConnectorRuntimeActionExecutionSchema>;
export type OpenConnectorRuntimeActionEffect =
  z.infer<OpenConnectorRuntimeActionEffectSchema>;
export type OpenConnectorRuntimeAction =
  z.infer<OpenConnectorRuntimeActionSchema>;
export type OpenConnectorRuntimeActionOperationMeta =
  z.infer<OpenConnectorRuntimeActionOperationMetaSchema>;
export type OpenConnectorRuntimeActionSearchResult =
  z.infer<OpenConnectorRuntimeActionSearchResultSchema>;
