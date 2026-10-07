import { agentActivityOverviewResponseSchema } from "@openmeld/schemas";
import type { CenterAgentReadAgentActivityToolRpcInput } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  rpcCenterAgentReadAgentActivity,
  rpcCenterAgentReadAgentActivityOverview,
} from "../../core/src/agent-activity/activity-center-agent-rpc";
import { AGENT_ACTIVITY_OVERVIEW_MAX_BYTES } from "../../core/src/agent-activity/activity-overview";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import { isRemoteAgentToolResultWithinLimit } from "../agent-core/tool-result-boundary";
import { createEvidenceFixture } from "./center-agent-evidence.test-support";
import { executeEvidenceCodeMode } from "./evidence-code-mode.test-support";
import { TEST_NOW_MS } from "./fixtures";

async function fixture() {
  const f = await createEvidenceFixture();
  for (let index = 0; index < 80; index += 1) {
    const id = `project-${String(index).padStart(3, "0")}`;
    const sessionId = `session-${index}`;
    const observedAt = TEST_NOW_MS + index;
    await f.harness.query({
      text: 'INSERT INTO openmeld."projects" (id, organization_id, name, slug, created_by_user_id, created_at_ms, updated_at_ms)\n        VALUES ($1, $2, $3, $4, $5, $6, $7)',
      values: [
        id,
        f.request.organizationId,
        `项目 ${index}`,
        id,
        f.speaker.ownerUserId,
        TEST_NOW_MS,
        observedAt,
      ],
    });
    await f.harness.query({
      text: "INSERT INTO openmeld.\"agent_activity_sessions\" (\n        id, organization_id, project_id, member_user_id, device_id, openmeld_service_runtime_id,\n        provider, client_kind, provider_session_id, title, status, last_observed_at_ms, expires_at_ms,\n        provider_metadata_json, last_event_id, last_accepted_sequence, created_at_ms, updated_at_ms\n      ) VALUES ($1, $2, $3, $4, 'device', 'runtime', 'codex', 'codex-cli', $5, $6, 'idle', $7, $8, '{}', $9, 1, $10, $11)",
      values: [
        sessionId,
        f.request.organizationId,
        id,
        f.speaker.ownerUserId,
        sessionId,
        "验证状态🙂".repeat(35),
        observedAt,
        observedAt + 60_000,
        `event-${index}`,
        TEST_NOW_MS,
        observedAt,
      ],
    });
    await f.harness.query({
      text: "INSERT INTO openmeld.\"agent_activity_digests\" (\n        id, organization_id, project_id, source_cursor_accepted_sequence, window_started_at_ms,\n        window_ended_at_ms, event_count, citations_json, summary, status, created_at_ms, expires_at_ms\n      ) VALUES ($1, $2, $3, 1, $4, $5, 1, $6, $7, 'completed', $8, $9)",
      values: [
        `digest-${index}`,
        f.request.organizationId,
        id,
        TEST_NOW_MS,
        observedAt,
        JSON.stringify([
          { eventId: `event-${index}`, observedAtMs: observedAt },
        ]),
        "已完成验证，保留证据。".repeat(100),
        observedAt,
        observedAt + 60_000,
      ],
    });
  }
  const input: CenterAgentReadAgentActivityToolRpcInput = {
    context: buildRemoteAgentCoreContext(
      f.callbackContext,
      "activity-evidence"
    ),
    speakerMember: { memberId: f.speaker.id, userId: f.speaker.ownerUserId },
  };
  const binding = {
    centerAgentReadAgentActivityOverview: (
      request: CenterAgentReadAgentActivityToolRpcInput
    ) => rpcCenterAgentReadAgentActivityOverview(f.env, request),
  };
  return { ...f, binding, input };
}

describe("bounded Center Agent activity overview", () => {
  it("returns useful real activity through Code Mode when the public snapshot exceeds 128 KiB", async () => {
    const f = await fixture();
    const full = await rpcCenterAgentReadAgentActivity(f.env, f.input);
    expect(full.digests).toHaveLength(80);
    expect(isRemoteAgentToolResultWithinLimit(full)).toBe(false);
    const output = await executeEvidenceCodeMode({
      fixture: f,
      binding: f.binding,
      toolName: "openmeld_read_agent_activity",
    });
    expect(output).toHaveProperty("result");
    const overview = agentActivityOverviewResponseSchema.parse(
      (output as { result: unknown }).result
    );
    expect(overview.sessions.length).toBeGreaterThan(0);
    expect(overview.digests.length).toBeGreaterThan(0);
    expect(overview.projects.length).toBeGreaterThan(0);
    expect(overview.sessions[0]?.id).toBe(full.sessions[0]?.id);
    expect(overview.digests[0]?.citations).toEqual(full.digests[0]?.citations);
    expect(overview.digests[0]?.createdAtMs).toBe(full.digests[0]?.createdAtMs);
    expect(overview.coverage.textShortened).toBe(true);
    expect(overview.coverage.omittedFromSnapshot.digests).toBe(
      80 - overview.digests.length
    );
    expect(overview.coverage.history).toBe("not_included");
    expect(isRemoteAgentToolResultWithinLimit(output)).toBe(true);
    expect(
      isRemoteAgentToolResultWithinLimit({ output: JSON.stringify(output) })
    ).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(overview)).byteLength
    ).toBeLessThanOrEqual(AGENT_ACTIVITY_OVERVIEW_MAX_BYTES);
    expect(
      agentActivityOverviewResponseSchema.parse(
        JSON.parse(JSON.stringify(overview))
      )
    ).toEqual(overview);
    // The old Web/CLI-facing snapshot still has its full owner-defined projection.
    expect(
      (await rpcCenterAgentReadAgentActivity(f.env, f.input)).digests[0]
        ?.summary
    ).toBe(full.digests[0]?.summary);
  });

  it("keeps member/project/provider/status filtering and rejects a revoked member", async () => {
    const f = await fixture();
    const overview = agentActivityOverviewResponseSchema.parse(
      await f.execute(f.binding, "openmeld_read_agent_activity", {
        projectId: "project-007",
        memberUserId: f.speaker.ownerUserId,
        provider: "codex",
        status: "idle",
      })
    );
    expect(overview.sessions).toHaveLength(1);
    expect(overview.sessions[0]).toMatchObject({
      id: "session-7",
      projectId: "project-007",
      provider: "codex",
      status: "idle",
    });
    expect(overview.digests).toEqual([]);
    expect(overview.coverage.digestsExcludedBySessionFilters).toBe(true);
    await f.harness.query({
      text: 'DELETE FROM openmeld."members" WHERE id = $1',
      values: [f.speaker.id],
    });
    await expect(
      f.execute(f.binding, "openmeld_read_agent_activity")
    ).rejects.toMatchObject({ status: 403 });
  });
});
