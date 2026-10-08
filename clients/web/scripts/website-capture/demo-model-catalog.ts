import { modelCatalogSchema } from "@openmeld/schemas";
import vendorModels from "../../../../release/vendor-models.json";

export const demoModelCatalog = modelCatalogSchema.parse(vendorModels);
