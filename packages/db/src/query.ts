// biome-ignore-all lint/performance/noBarrelFile: Shared tables and their query operators must use the same Drizzle instance.

export type { InferInsertModel, InferSelectModel } from "drizzle-orm";
// Direct vendor exports only. Do not bundle Drizzle or import Node-only DB
// tooling here: Auth/Core Workers consume this entrypoint alongside DB tables.
export {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
