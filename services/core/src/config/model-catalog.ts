import {
  type ModelCatalogReadOptions,
  modelCatalogSchema,
} from "@openmeld/schemas";
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

export function readModelCatalog(
  options?: ModelCatalogReadOptions
): ModelCatalog {
  return projectModelCatalog(readAuthoredModelCatalog(), options);
}

/** Keep authored policy out of legacy responses; never flatten scoped withdrawal. */
export function projectModelCatalog(
  catalog: ModelCatalog,
  options?: ModelCatalogReadOptions
): ModelCatalog {
  return {
    ...catalog,
    agentControllers: Object.fromEntries(
      Object.entries(catalog.agentControllers).map(([id, controller]) => {
        const { creationDefaults: _creationDefaults, ...publicController } =
          controller;
        return [
          id,
          {
            ...publicController,
            models: controller.models.map((model) => {
              const { retirement, ...legacyModel } = model;
              return options?.retirement && retirement
                ? { ...legacyModel, retirement }
                : legacyModel;
            }),
          },
        ];
      })
    ),
  };
}
