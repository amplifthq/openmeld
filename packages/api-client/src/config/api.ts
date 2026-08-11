import { getModelCatalogResponseSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildModelCatalogPath } from "./routes";
import type { CreateConfigApi } from "./types";

export const createConfigApi: CreateConfigApi = (
  client: OpenMeldApiClientFoundation
) => {
  return {
    getModelCatalog: () => getModelCatalog(client),
  };
};

export async function getModelCatalog(client: OpenMeldApiClientFoundation) {
  return await client.requestJson({
    url: buildModelCatalogPath(),
    operation: "config.model_catalog.read",
    method: "GET",
    schema: getModelCatalogResponseSchema,
    invalidMessage: "invalid model catalog response",
  });
}
