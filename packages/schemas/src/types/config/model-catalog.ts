import type { z } from "zod/v4";

type GetModelCatalogResponseSchema =
  typeof import("../../schemas/config/model-catalog")["getModelCatalogResponseSchema"];
type ModelCatalogAgentControllerSchema =
  typeof import("../../schemas/config/model-catalog")["modelCatalogAgentControllerSchema"];
type ModelCatalogHostedRuntimePolicySchema =
  typeof import("../../schemas/config/model-catalog")["modelCatalogHostedRuntimePolicySchema"];
type ModelCatalogHostedRuntimeSchema =
  typeof import("../../schemas/config/model-catalog")["modelCatalogHostedRuntimeSchema"];
type ModelCatalogModelSchema =
  typeof import("../../schemas/config/model-catalog")["modelCatalogModelSchema"];
type ModelCatalogSchema =
  typeof import("../../schemas/config/model-catalog")["modelCatalogSchema"];

export type GetModelCatalogResponse = z.infer<GetModelCatalogResponseSchema>;
export type ModelCatalog = z.infer<ModelCatalogSchema>;
export type ModelCatalogAgentController =
  z.infer<ModelCatalogAgentControllerSchema>;
export type ModelCatalogHostedRuntime =
  z.infer<ModelCatalogHostedRuntimeSchema>;
export type ModelCatalogHostedRuntimePolicy =
  z.infer<ModelCatalogHostedRuntimePolicySchema>;
export type ModelCatalogModel = z.infer<ModelCatalogModelSchema>;
