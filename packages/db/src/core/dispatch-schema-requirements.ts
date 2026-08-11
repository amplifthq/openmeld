import {
  buildSqliteSchemaRequirements,
  type SqliteRequiredNamedIndex,
  type SqliteRequiredNamedIndexColumn,
  type SqliteRequiredSchemaObject,
  type SqliteRequiredTableColumn,
  type SqliteRequiredUniqueConstraint,
} from "../shared/sqlite-schema-requirements.ts";
import { coreSchema } from "./dispatch.schema.ts";

export type CoreRequiredSchemaObject = SqliteRequiredSchemaObject;
export type CoreRequiredTableColumn = SqliteRequiredTableColumn;
export type CoreRequiredNamedIndexColumn = SqliteRequiredNamedIndexColumn;
export type CoreRequiredNamedIndex = SqliteRequiredNamedIndex;
export type CoreRequiredUniqueConstraint = SqliteRequiredUniqueConstraint;

const coreRequirements = buildSqliteSchemaRequirements(coreSchema);

export const CORE_DISPATCH_REQUIRED_SCHEMA_OBJECTS =
  coreRequirements.schemaObjects;
export const CORE_DISPATCH_REQUIRED_TABLE_COLUMNS =
  coreRequirements.tableColumns;
export const CORE_DISPATCH_REQUIRED_NAMED_INDEXES =
  coreRequirements.namedIndexes;
export const CORE_DISPATCH_REQUIRED_UNIQUE_CONSTRAINTS =
  coreRequirements.uniqueConstraints;
