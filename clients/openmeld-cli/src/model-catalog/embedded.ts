import { modelCatalogSchema } from "@openmeld/schemas";
import type { ModelCatalog } from "@openmeld/schemas/types";
import embeddedModelCatalog from "../../../../release/vendor-models.json";

let cachedModelCatalog: ModelCatalog | null = null;

export function readEmbeddedModelCatalog(): ModelCatalog {
  if (cachedModelCatalog) {
    return cachedModelCatalog;
  }
  cachedModelCatalog = modelCatalogSchema.parse(embeddedModelCatalog);
  return cachedModelCatalog;
}
