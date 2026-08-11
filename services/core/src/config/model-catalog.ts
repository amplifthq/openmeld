import { modelCatalogSchema } from "@openmeld/schemas";
import type { ModelCatalog } from "@openmeld/schemas/types";
import vendorModelCatalog from "../../../../release/vendor-models.json";

export function readModelCatalog(): ModelCatalog {
  const parsed = modelCatalogSchema.safeParse(vendorModelCatalog);
  if (!parsed.success) {
    throw new Error(
      `model catalog release manifest is invalid: ${parsed.error.issues[0]?.message ?? "unknown schema error"}`
    );
  }
  return parsed.data;
}
