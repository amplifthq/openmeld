import { modelCatalogSchema } from "@openmeld/schemas";
import type { ModelCatalog } from "@openmeld/schemas/types";
import vendorModelCatalog from "../../../../release/vendor-models.json";

export function readAuthoredModelCatalog(): ModelCatalog {
  const parsed = modelCatalogSchema.safeParse(vendorModelCatalog);
  if (!parsed.success) {
    throw new Error(
      `model catalog release manifest is invalid: ${parsed.error.issues[0]?.message ?? "unknown schema error"}`
    );
  }
  return parsed.data;
}

/** Keep creation policy inside Core; old clients validate this response strictly. */
export function readModelCatalog(): ModelCatalog {
  const catalog = readAuthoredModelCatalog();
  return {
    ...catalog,
    agentControllers: Object.fromEntries(
      Object.entries(catalog.agentControllers).map(([id, controller]) => {
        const { creationDefaults: _creationDefaults, ...publicController } =
          controller;
        return [id, publicController];
      })
    ),
  };
}
