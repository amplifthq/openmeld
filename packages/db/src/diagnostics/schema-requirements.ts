import history from "../../d1-history/physical-requirements.json" with {
  type: "json",
};
import type { SqliteSchemaRequirements } from "../shared/sqlite-schema-requirements.ts";

// Frozen pre-port D1 contract; current PostgreSQL journal owns native admission.
const diagnosticsRequirements = history.diagnostics as SqliteSchemaRequirements;

export const DIAGNOSTICS_REQUIRED_SCHEMA_OBJECTS =
  diagnosticsRequirements.schemaObjects;
export const DIAGNOSTICS_REQUIRED_TABLE_COLUMNS =
  diagnosticsRequirements.tableColumns;
export const DIAGNOSTICS_REQUIRED_NAMED_INDEXES =
  diagnosticsRequirements.namedIndexes;
export const DIAGNOSTICS_REQUIRED_UNIQUE_CONSTRAINTS =
  diagnosticsRequirements.uniqueConstraints;
