import { sql } from "drizzle-orm";
import { bigint, check, integer, text, uniqueIndex } from "drizzle-orm/pg-core";
import { applicationTable } from "../postgresql/schema.ts";

// Last-seen fact per (OpenMeld Service Runtime, Agent Controller) derived from
// accepted catalog reports. It debounces MemberAgent presence: a Harness
// reads as missing only after several consecutive reports without it or
// after a few minutes, so an upgrade or PATH hiccup never greys an Agent.
// It is a recomputable projection, never Binding or readiness truth.
export const openMeldDaemonRuntimeHarnessPresence = applicationTable(
  "openMeldDaemon_runtime_harness_presence",
  {
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").notNull(),
    agentControllerRef: text("agent_controller_ref").notNull(),
    lastReportObservedAtMs: bigint("last_report_observed_at_ms", {
      mode: "number",
    }).notNull(),
    lastDetectedAtMs: bigint("last_detected_at_ms", { mode: "number" }),
    undetectedReportCount: integer("undetected_report_count")
      .notNull()
      .default(0),
    firstUndetectedAtMs: bigint("first_undetected_at_ms", { mode: "number" }),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex(
      "openMeldDaemon_runtime_harness_presence_runtime_controller_unique"
    ).on(table.openMeldServiceRuntimeId, table.agentControllerRef),
    check(
      "openMeldDaemon_runtime_harness_presence_runtime_id_non_empty_check",
      sql`length(trim("openmeld_service_runtime_id")) > 0`
    ),
    check(
      "openMeldDaemon_runtime_harness_presence_controller_ref_non_empty_check",
      sql`length(trim("agent_controller_ref")) > 0`
    ),
    check(
      "openMeldDaemon_runtime_harness_presence_undetected_count_check",
      sql`"undetected_report_count" >= 0`
    ),
  ]
);
