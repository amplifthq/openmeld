import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { applyFolderSelectionPolicy } from "../src/dispatch/application/accepted-dispatch-snapshot";
import type { CoreBindings } from "../src/lib/bindings";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

// These cases cover the path without request chains; the enforced path is
// covered by the *-request-chain tests.
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => false,
  isRequestChainEnforced: () => false,
}));

// Smoke round 2b: the owner chose a folder in their own DM and the task ran in
// the default folder. Human Profiles have no organization_id, so an
// Organization-scoped owner lookup never found them and stripped the folder.

const FOLDER_ID = "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11";
const OWNER_HUMAN = "11111111-1111-4111-8111-111111111111";
const COLLEAGUE_HUMAN = "22222222-2222-4222-8222-222222222222";
const OUTSIDER_HUMAN = "33333333-3333-4333-8333-333333333333";
const OWNER_AGENT = "agt_00000000-0000-4000-8000-000000000001";

function message(
  requesterProfileId: string
): OpenMeldDaemonDispatchQueueMessage {
  return {
    contextSelection: { folderId: FOLDER_ID, mode: "new" },
    dispatchId: "dispatch-1",
    organizationId: "org_1",
    sourceSignalSnapshot: { profileId: requesterProfileId },
  } as unknown as OpenMeldDaemonDispatchQueueMessage;
}

describe("folder selection owner lookup (PostgreSQL)", () => {
  it("keeps the owner's folder and strips it for colleagues and non-members", async () => {
    const harness = await createPostgresHarness();
    try {
      for (const [id, email] of [
        ["user_owner", "owner@example.test"],
        ["user_colleague", "colleague@example.test"],
        ["user_outsider", "outsider@example.test"],
      ]) {
        await harness.query({
          text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ($1,$1,$2)`,
          values: [id, email],
        });
      }
      await harness.query({
        text: `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('org_1','Organization','org-1',1000)`,
      });
      for (const [id, userId] of [
        ["member_owner", "user_owner"],
        ["member_colleague", "user_colleague"],
      ]) {
        await harness.query({
          text: `INSERT INTO "openmeld"."members" (id, role, organization_id, user_id, "created_at") VALUES ($1, 'member', 'org_1', $2, 1700000000000)`,
          values: [id, userId],
        });
      }
      for (const [profileId, userId, handle] of [
        [OWNER_HUMAN, "user_owner", "owner"],
        [COLLEAGUE_HUMAN, "user_colleague", "colleague"],
        [OUTSIDER_HUMAN, "user_outsider", "outsider"],
      ]) {
        await harness.query({
          text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, organization_id, profile_kind, profile_name, owner_user_id, managed_role, status, profile_handle, source, is_default) VALUES ($1, NULL, 'human', $3, $2, NULL, 'active', $3, 'auth_bootstrap', 1)`,
          values: [profileId, userId, handle],
        });
      }
      await harness.query({
        text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, organization_id, profile_kind, profile_name, owner_user_id, managed_role, status, profile_handle, source) VALUES ($1, 'org_1', 'agent', 'Codex', 'user_owner', NULL, 'active', 'codex', 'web_create')`,
        values: [OWNER_AGENT],
      });
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;
      const apply = (requester: string) =>
        applyFolderSelectionPolicy({
          env,
          message: message(requester),
          targetOwnerUserId: "user_owner",
        });

      await expect(apply(OWNER_HUMAN)).resolves.toEqual({
        folderId: FOLDER_ID,
        mode: "new",
      });
      // The owner's own Agent in this Organization (delegation before the chain).
      await expect(apply(OWNER_AGENT)).resolves.toEqual({
        folderId: FOLDER_ID,
        mode: "new",
      });
      await expect(apply(COLLEAGUE_HUMAN)).resolves.toEqual({ mode: "new" });
      // A human Profile whose owner is not a member of this Organization.
      await expect(apply(OUTSIDER_HUMAN)).resolves.toEqual({ mode: "new" });
    } finally {
      await harness.close();
    }
  });
});
