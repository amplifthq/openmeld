import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { organizations } from "../auth/auth.schema.ts";

// Space owns Task truth. Readers use these candidate keys only after checking
// current Space membership and the Task's current Project association.
export const spaceTaskProjectProjectionStates = sqliteTable(
  "space_task_project_projection_states",
  {
    spaceId: text("space_id").notNull(),
    taskId: text("task_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskRevision: integer("task_revision").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.taskId] })]
);

export const spaceTaskProjectLinks = sqliteTable(
  "space_task_project_links",
  {
    spaceId: text("space_id").notNull(),
    taskId: text("task_id").notNull(),
    projectId: text("project_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskRevision: integer("task_revision").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.taskId, table.projectId] }),
    index("space_task_project_links_project_updated_idx").on(
      table.organizationId,
      table.projectId,
      table.updatedAtMs
    ),
  ]
);
