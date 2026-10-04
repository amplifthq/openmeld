import history from "../../d1-history/physical-requirements.json" with {
  type: "json",
};
import type {
  SqliteRequiredNamedIndex,
  SqliteRequiredNamedIndexColumn,
  SqliteRequiredSchemaObject,
  SqliteRequiredTableColumn,
  SqliteRequiredUniqueConstraint,
  SqliteSchemaRequirements,
} from "../shared/sqlite-schema-requirements.ts";

export type CoreRequiredSchemaObject = SqliteRequiredSchemaObject;
export type CoreRequiredTableColumn = SqliteRequiredTableColumn;
export type CoreRequiredNamedIndexColumn = SqliteRequiredNamedIndexColumn;
export type CoreRequiredNamedIndex = SqliteRequiredNamedIndex;
export type CoreRequiredUniqueConstraint = SqliteRequiredUniqueConstraint;

// Frozen pre-port D1 contract; current PostgreSQL journal owns native admission.
const coreRequirements = history.core as SqliteSchemaRequirements;

export const CORE_DISPATCH_REQUIRED_SCHEMA_OBJECTS =
  coreRequirements.schemaObjects;
export const CORE_DISPATCH_REQUIRED_TABLE_COLUMNS =
  coreRequirements.tableColumns;
export const CORE_DISPATCH_REQUIRED_NAMED_INDEXES =
  coreRequirements.namedIndexes;
export const CORE_DISPATCH_REQUIRED_UNIQUE_CONSTRAINTS =
  coreRequirements.uniqueConstraints;
