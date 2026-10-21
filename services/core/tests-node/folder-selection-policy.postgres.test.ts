import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  applyFolderSelectionPolicy,
  buildAcceptedDispatchSnapshot,
} from "../src/dispatch/application/accepted-dispatch-snapshot";
import type { CoreBindings } from "../src/lib/bindings";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const FOLDER_ID = "6f1f1d0e-8f8e-4a59-9c39-7d2b8c1e4a11";
const ORG = "org_folders";
const OWNER_HUMAN = "11111111-1111-4111-8111-111111111111";
const COLLEAGUE_HUMAN = "22222222-2222-4222-8222-222222222222";
const OUTSIDER_HUMAN = "33333333-3333-4333-8333-333333333333";
const OWNER_AGENT = "agt_44444444-4444-4444-8444-444444444444";
const TARGET_AGENT = "agt_55555555-5555-4555-8555-555555555555";

/** The dispatch fields the snapshot and the policy read (smoke R2B-08). */
function dispatchMessage(
  requesterProfileId: string
): OpenMeldDaemonDispatchQueueMessage {
  return {
    contextSelection: {
      folderId: FOLDER_ID,
      mode: "new",
      workspace: "current",
    },
    controllerSnapshot: {
      agentControllerRef: "builtin:codex",
      bindingId: "binding-1",
      configurationRevision: 3,
      targetBindingEnabled: true,
      targetBindingState: "bound",
    },
    dispatchId: "dispatch-1",
    dispatchSnapshot: {
      targetBindingEnabled: true,
      targetBindingState: "bound",
    },
    organizationId: ORG,
    sourceSignalSnapshot: { profileId: requesterProfileId },
    spaceId: "space-1",
    targetProfileId: TARGET_AGENT,
  } as unknown as OpenMeldDaemonDispatchQueueMessage;
}

async function seed() {
  const harness = await createPostgresHarness();
  const run = (text: string, values: unknown[] = []) =>
    harness.query({ text, values });
  for (const [id, email] of [
    ["user_owner", "owner@example.test"],
    ["user_colleague", "colleague@example.test"],
    ["user_outsider", "outsider@example.test"],
  ]) {
    await run(
      `INSERT INTO "openmeld"."users" (id,name,email) VALUES ($1,$1,$2)`,
      [id, email]
    );
  }
  await run(
    `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ($1,'Folders','folders',1000)`,
    [ORG]
  );
  for (const [id, user] of [
    ["member_owner", "user_owner"],
    ["member_colleague", "user_colleague"],
  ]) {
    await run(
      `INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, "created_at") VALUES ($1, $2, $3, 'member', 1700000000000)`,
      [id, ORG, user]
    );
  }
  // Human Profiles belong to the account: no organization_id.
  for (const [profileId, user, handle] of [
    [OWNER_HUMAN, "user_owner", "owner"],
    [COLLEAGUE_HUMAN, "user_colleague", "colleague"],
    [OUTSIDER_HUMAN, "user_outsider", "outsider"],
  ]) {
    await run(
      `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, organization_id, profile_kind, profile_name, owner_user_id, status, profile_handle, source, is_default) VALUES ($1, NULL, 'human', $3, $2, 'active', $3, 'auth_bootstrap', 1)`,
      [profileId, user, handle]
    );
  }
  await run(
    `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, organization_id, profile_kind, profile_name, owner_user_id, status, profile_handle, source) VALUES ($1, $2, 'agent', 'Codex', 'user_owner', 'active', 'codex', 'web_create')`,
    [OWNER_AGENT, ORG]
  );
  const env = {
    OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
  } as unknown as CoreBindings;
  return { env, harness };
}

describe("folder selection policy against PostgreSQL", () => {
  it.each([
    ["the owner's own Human Profile", OWNER_HUMAN, "user_owner", true],
    ["the owner's own Agent", OWNER_AGENT, "user_owner", true],
    ["a colleague", COLLEAGUE_HUMAN, "user_owner", false],
    // Owns the target but is not a member of this Organization.
    ["a non-member", OUTSIDER_HUMAN, "user_outsider", false],
  ])("keeps the folder for %s only when the owner asked", async (_case, requester, targetOwnerUserId, kept) => {
    const { env, harness } = await seed();
    try {
      const message = dispatchMessage(requester);
      const contextSelection = await applyFolderSelectionPolicy({
        env,
        message,
        targetOwnerUserId,
      });
      const snapshot = await buildAcceptedDispatchSnapshot({
        contextSelection,
        message,
        openMeldServiceRuntimeId: "runtime-1",
        runtimeKind: "openmeld_service",
      });
      // The selection Core hands to the Execution Context authority.
      expect(snapshot?.contextRequest?.selection).toEqual(
        kept
          ? { folderId: FOLDER_ID, mode: "new", workspace: "current" }
          : { mode: "new", workspace: "current" }
      );
    } finally {
      await harness.close();
    }
  });
});
