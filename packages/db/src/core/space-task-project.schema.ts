import { bigint, index, integer, primaryKey, text } from "drizzle-orm/pg-core";
import { organizations } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

// Space owns Task truth. Readers use these candidate keys only after checking
// current Space membership and the Task's current Project association.
export const spaceTaskProjectProjectionStates = applicationTable(
  "space_task_project_projection_states",
  {
    spaceId: text("space_id").notNull(),
    taskId: text("task_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskRevision: integer("task_revision").notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.spaceId, table.taskId] })]
);

export const spaceTaskProjectLinks = applicationTable(
  "space_task_project_links",
  {
    spaceId: text("space_id").notNull(),
    taskId: text("task_id").notNull(),
    projectId: text("project_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskRevision: integer("task_revision").notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
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
