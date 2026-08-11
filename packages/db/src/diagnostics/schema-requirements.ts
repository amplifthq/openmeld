import { buildSqliteSchemaRequirements } from "../shared/sqlite-schema-requirements.ts";
import { diagnosticsSchema } from "./schema.ts";

const diagnosticsRequirements =
  buildSqliteSchemaRequirements(diagnosticsSchema);

export const DIAGNOSTICS_REQUIRED_SCHEMA_OBJECTS =
  diagnosticsRequirements.schemaObjects;
export const DIAGNOSTICS_REQUIRED_TABLE_COLUMNS =
  diagnosticsRequirements.tableColumns;
export const DIAGNOSTICS_REQUIRED_NAMED_INDEXES =
  diagnosticsRequirements.namedIndexes;
export const DIAGNOSTICS_REQUIRED_UNIQUE_CONSTRAINTS =
  diagnosticsRequirements.uniqueConstraints;
