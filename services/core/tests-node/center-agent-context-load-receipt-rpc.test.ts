import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcCreateCenterAgentContextLoadReceipt,
  rpcListCenterAgentAuditJournal,
} from "../src/rpc/methods";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const CENTER_AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const HUMAN_PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_HUMAN_PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const MANIFEST_ID =
  "center_agent_context_manifest_55555555-5555-4555-8555-555555555555";
const FIRST_HASH = `sha256:${"a".repeat(64)}` as const;
const SECOND_HASH = `sha256:${"b".repeat(64)}` as const;

describe("Center Agent context load receipt RPC", () => {
  it("records one exact, idempotent receipt and exposes it only to v16 audit readers", async () => {
    const harness = await createHarness();
    try {
      await insertManifestFixture(harness);
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as CoreBindings;
      const request = {
        context: humanContext({
          profileId: HUMAN_PROFILE_ID,
          userId: "user-1",
        }),
        manifestId: MANIFEST_ID,
        selection: { kind: "all_manifest_entries" as const },
        source: {
          client: "codex",
          kind: "local_agent" as const,
          sessionId: "private-codex-session",
        },
      };

      const first = await rpcCreateCenterAgentContextLoadReceipt(env, request);
      const replay = await rpcCreateCenterAgentContextLoadReceipt(env, request);

      expect(first).toEqual(replay);
      expect(first).toMatchObject({
        authorization: {
          principal: "authenticated_member",
          scope: "requester_private",
        },
        receipt: {
          client: "codex",
          estimatedTokens: 180,
          includedMessages: 2,
          manifestId: MANIFEST_ID,
          selectedEntries: [
            { materializedContentHash: FIRST_HASH, sourceRefId: "signal-1" },
            { materializedContentHash: SECOND_HASH, sourceRefId: "signal-2" },
          ],
          status: "loaded",
        },
        schemaVersion: "center_agent_context_load_receipt.v1",
      });
      expect(
        (
          await harness.queryFirst<{ count: number }>({
            text: 'SELECT COUNT(*) AS count FROM "openmeld"."center_agent_context_load_receipts"',
          })
        )?.count
      ).toBe(1);

      const v15 = await rpcListCenterAgentAuditJournal(env, {
        actionSet: "v15",
        context: request.context,
      });
      expect(
        v15.entries.some(
          (entry) => entry.action === "load_center_agent_context"
        )
      ).toBe(false);
      expect(v15.entries[0]).not.toHaveProperty("contextManifest");

      const v16 = await rpcListCenterAgentAuditJournal(env, {
        actionSet: "v16",
        context: request.context,
      });
      const loadEntry = v16.entries.find(
        (entry) => entry.action === "load_center_agent_context"
      );
      const manifestEntry = v16.entries.find(
        (entry) => entry.action === "read_center_agent_context"
      );
      expect(loadEntry).toMatchObject({
        contextLoad: {
          estimatedTokens: 180,
          includedMessages: 2,
          manifestId: MANIFEST_ID,
        },
        interactionSource: { client: "codex", kind: "local_agent" },
        onBehalfOf: {
          displayName: "Mira",
          profileId: HUMAN_PROFILE_ID,
          userId: "user-1",
        },
        resource: { type: "center_agent_context_load_receipt" },
      });
      expect(manifestEntry).toMatchObject({
        contextManifest: {
          estimatedTokens: 180,
          includedMessages: 2,
          truncated: true,
        },
        interactionSource: { client: "codex", kind: "local_agent" },
      });
      expect(JSON.stringify(v16)).not.toContain("private-codex-session");
    } finally {
      await harness.close();
    }
  });

  it("reauthorizes every report and rejects a different requester, client, or load", async () => {
    const harness = await createHarness();
    try {
      await insertManifestFixture(harness);
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as CoreBindings;
      const context = humanContext({
        profileId: HUMAN_PROFILE_ID,
        userId: "user-1",
      });

      await expect(
        rpcCreateCenterAgentContextLoadReceipt(env, {
          context: humanContext({
            profileId: OTHER_HUMAN_PROFILE_ID,
            userId: "user-2",
          }),
          manifestId: MANIFEST_ID,
          selection: { kind: "all_manifest_entries" },
          source: { client: "codex", kind: "local_agent" },
        })
      ).rejects.toMatchObject({
        code: "center_agent.context_manifest_not_found",
        status: 404,
      });
      await expect(
        rpcCreateCenterAgentContextLoadReceipt(env, {
          context,
          manifestId: MANIFEST_ID,
          selection: { kind: "all_manifest_entries" },
          source: { client: "claude-code", kind: "local_agent" },
        })
      ).rejects.toMatchObject({
        code: "center_agent.context_load_client_mismatch",
        status: 409,
      });

      await rpcCreateCenterAgentContextLoadReceipt(env, {
        context,
        manifestId: MANIFEST_ID,
        selection: {
          entries: [
            { materializedContentHash: FIRST_HASH, sourceRefId: "signal-1" },
          ],
          kind: "selected_entries",
        },
        source: { client: "codex", kind: "local_agent" },
      });
      await expect(
        rpcCreateCenterAgentContextLoadReceipt(env, {
          context,
          manifestId: MANIFEST_ID,
          selection: { kind: "all_manifest_entries" },
          source: { client: "codex", kind: "local_agent" },
        })
      ).rejects.toMatchObject({
        code: "center_agent.context_load_already_recorded",
        status: 409,
      });
    } finally {
      await harness.close();
    }
  });

  it("does not turn an older manifest without materializations into a false load receipt", async () => {
    const harness = await createHarness();
    try {
      await insertManifestFixture(harness, { includeMaterializations: false });

      await expect(
        rpcCreateCenterAgentContextLoadReceipt(
          {
            OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
          } as CoreBindings,
          {
            context: humanContext({
              profileId: HUMAN_PROFILE_ID,
              userId: "user-1",
            }),
            manifestId: MANIFEST_ID,
            selection: { kind: "all_manifest_entries" },
            source: { client: "codex", kind: "local_agent" },
          }
        )
      ).rejects.toMatchObject({
        code: "center_agent.context_load_manifest_empty",
        status: 409,
      });
      expect(
        (
          await harness.queryFirst<{ count: number }>({
            text: 'SELECT COUNT(*) AS count FROM "openmeld"."center_agent_context_load_receipts"',
          })
        )?.count
      ).toBe(0);
    } finally {
      await harness.close();
    }
  });
});

async function createHarness() {
  const harness = await createPostgresHarness();

  await harness.query({
    text: 'INSERT INTO "openmeld"."organizations" (id, "name", "slug", "created_at") VALUES (\'org-1\', \'Test Organization\', (\'org-1\')::text, 1700000000000)',
  });
  await harness.query({
    text: `
      INSERT INTO "openmeld"."users" (id, name, "email")
      VALUES ('user-1', 'Mira', ('user-1')::text || '@example.com'),
('user-2', 'Noah', ('user-2')::text || '@example.com')
    `,
  });
  await harness.query({
    text: `
      INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, "created_at")
      VALUES
        ('member-1', 'org-1', 'user-1', 'owner', 1700000000000),
('member-2', 'org-1', 'user-2', 'member', 1700000000000)
    `,
  });
  await harness.query({
    values: [CENTER_AGENT_PROFILE_ID, HUMAN_PROFILE_ID, OTHER_HUMAN_PROFILE_ID],
    text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id,
        profile_name,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        managed_role, profile_handle, source, created_by_user_id
      )
      VALUES
        ($1, 'Center Agent', 'agent', 0, 'active', 'org-1', NULL, 'center_agent', 'center-agent', 'auth_bootstrap', 'user-1'),
        ($2, 'Mira', 'human', 1, 'active', NULL, 'user-1', NULL, 'mira', 'auth_bootstrap', NULL),
        ($3, 'Noah', 'human', 1, 'active', NULL, 'user-2', NULL, 'noah', 'auth_bootstrap', NULL)
    `,
  });
  return harness;
}

async function insertManifestFixture(
  harness: Awaited<ReturnType<typeof createHarness>>,
  input: { includeMaterializations?: boolean } = {}
): Promise<void> {
  await harness.query({
    values: [
      "audit-manifest",
      CENTER_AGENT_PROFILE_ID,
      HUMAN_PROFILE_ID,
      MANIFEST_ID,
    ],
    text: `
      INSERT INTO "openmeld"."center_agent_audit_journal" (
        id,
        organization_id,
        actor_profile_id,
        action,
        on_behalf_of_profile_id,
        on_behalf_of_user_id,
        on_behalf_of_display_name,
        resource_type,
        resource_id,
        created_at
      )
      VALUES ($1, 'org-1', $2, 'read_center_agent_context', $3, 'user-1', 'Mira',
        'center_agent_context_manifest', $4, 1000)
    `,
  });
  await harness.query({
    values: [
      MANIFEST_ID,
      HUMAN_PROFILE_ID,
      CENTER_AGENT_PROFILE_ID,
      JSON.stringify([
        sourceRef("signal-1", FIRST_HASH),
        sourceRef("signal-2", SECOND_HASH),
      ]),
    ],
    text: `
      INSERT INTO "openmeld"."center_agent_context_manifests" (
        id,
        organization_id,
        requested_by_profile_id,
        actor_profile_id,
        conversation_space_id,
        client_name,
        view,
        schema_version,
        requested_token_budget,
        estimated_token_count,
        included_message_count,
        truncated,
        truncation_reasons_json,
        continuation_cursor,
        source_refs_json,
        audit_entry_id,
        created_at
      )
      VALUES ($1, 'org-1', $2, $3, 'space-center-agent', 'codex', 'messages',
        'center_agent_context_manifest.v1', 8000, 180, 2, 1,
        '["older_messages_available"]', NULL, $4, 'audit-manifest', 1000)
    `,
  });
  if (input.includeMaterializations === false) {
    return;
  }
  await harness.query({
    values: [
      MANIFEST_ID,
      JSON.stringify([
        {
          estimatedTokens: 100,
          materializedContentHash: FIRST_HASH,
          sourceRef: sourceRef("signal-1", FIRST_HASH),
        },
        {
          estimatedTokens: 80,
          materializedContentHash: SECOND_HASH,
          sourceRef: sourceRef("signal-2", SECOND_HASH),
        },
      ]),
    ],
    text: `
      INSERT INTO "openmeld"."center_agent_context_manifest_materializations" (
        manifest_id,
        entries_json,
        created_at
      )
      VALUES ($1, $2, 1000)
    `,
  });
}

function sourceRef(signalId: string, version: string) {
  return {
    id: signalId,
    type: "space_signal",
    uri: `openmeld://spaces/space-center-agent/signals/${signalId}`,
    version,
  } as const;
}

function humanContext(input: {
  profileId: string;
  userId: string;
}): OpenMeldRequestContext {
  return {
    activeOrganizationId: "org-1",
    actorContext: {
      callerPrincipalId: input.userId,
      ownerUserId: input.userId,
      profileKind: "human",
      profileName: input.userId === "user-1" ? "Mira" : "Noah",
      requestId: `request:${input.userId}`,
      openMeldProfileId: input.profileId,
    },
  };
}
