import * as z from "../../lazy-zod";
import {
  agentActivityPublicDigestSchema,
  agentActivityPublicEventSchema,
  agentActivityPublicSessionSchema,
  agentActivitySnapshotResponseSchema,
} from "./agent-activity";
import { projectSchema } from "./projects";

const omittedCountSchema = z.number().int().nonnegative();

/** Private tool projection; the public Web/CLI snapshot stays unchanged. */
export const agentActivityOverviewResponseSchema =
  agentActivitySnapshotResponseSchema.extend({
    projects: z
      .array(
        projectSchema.pick({
          id: true,
          name: true,
          archivedAtMs: true,
          updatedAtMs: true,
        })
      )
      .max(12),
    sessions: z.array(agentActivityPublicSessionSchema).max(16),
    digests: z.array(agentActivityPublicDigestSchema).max(8),
    recentEvents: z.array(agentActivityPublicEventSchema).max(16),
    coverage: z.strictObject({
      kind: z.literal("bounded_current_snapshot"),
      history: z.literal("not_included"),
      providerMetadata: z.literal("not_included"),
      textShortened: z.boolean(),
      omittedFromSnapshot: z.strictObject({
        projects: omittedCountSchema,
        sessions: omittedCountSchema,
        digests: omittedCountSchema,
        recentEvents: omittedCountSchema,
      }),
      sourceLimitReached: z.strictObject({
        projects: z.boolean(),
        sessions: z.boolean(),
        digests: z.boolean(),
        recentEvents: z.boolean(),
      }),
      digestsExcludedBySessionFilters: z.boolean(),
      continuation: z.literal("openmeld_list_agent_activity_sessions"),
      continuationScope: z.literal(
        "live_session_inventory_not_snapshot_or_history"
      ),
    }),
  });
