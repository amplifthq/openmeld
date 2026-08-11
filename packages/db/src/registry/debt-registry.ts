import { dbDebtRegistryItemSchema } from "@openmeld/schemas";
import type { DbDebtRegistryItem } from "@openmeld/schemas/types";

const debtRegistry = [] satisfies DbDebtRegistryItem[];

export const dbDebtRegistry = debtRegistry.map((item) =>
  dbDebtRegistryItemSchema.parse(item)
);
