import { spaceTaskGitHubIssueOperationId } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  claimGitHubAppWebhookDelivery,
  completeGitHubAppWebhookDelivery,
} from "../src/space/infrastructure/postgresql/github-app-webhook-delivery-repo";
import {
  listActiveSpaceTaskGitHubIssueLinks,
  projectSpaceTaskGitHubIssueLinks,
} from "../src/space/infrastructure/postgresql/space-task-github-issue-link-repo";
import { processGitHubAppWebhookQueueMessage } from "../src/space/transport/queue/github-app-webhook-queue-consumer";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const SPACE_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TASK_ID = "tsk_55555555-5555-4555-8555-555555555555";
const OTHER_SPACE_ID =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const githubItem = {
  lastObservedAt: "2026-09-20T00:00:00.000Z",
  lastObservedState: "open" as const,
  number: 1143,
  owner: "AmpliftHQ",
  provider: "github" as const,
  repo: "OpenMeld",
  url: "https://github.com/amplifthq/openmeld/issues/1143",
};

const task = {
  assignee: null,
  automaticReworkRounds: 0,
  completionConditions: [],
  createdAt: "2026-09-20T00:00:00.000Z",
  createdBy: {
    ownerUserId: "user-avery",
    profileId: "11111111-1111-4111-8111-111111111111",
    profileKind: "human" as const,
    profileName: "Avery",
  },
  description: null,
  externalWorkItems: [githubItem],
  projectIds: [],
  needsHumanDecision: false,
  phase: "to_do" as const,
  requestedBy: {
    ownerUserId: "user-avery",
    profileId: "11111111-1111-4111-8111-111111111111",
    profileKind: "human" as const,
    profileName: "Avery",
  },
  result: null,
  review: null,
  reviewer: null,
  revision: 1,
  sourceSignalId: null,
  spaceId: SPACE_ID,
  taskId: TASK_ID,
  threadId: null,
  title: "Follow GitHub issue #1143",
  updatedAt: "2026-09-20T00:00:00.000Z",
};

async function createDeliveryHarness() {
  const harness = await createPostgresHarness();

  return harness;
}

async function createLinkHarness() {
  const harness = await createPostgresHarness();

  await harness.query({
    values: ["org-1", "Acme", "acme", 1],
    text: `
      INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
      VALUES ($1, $2, $3, $4)
    `,
  });
  return harness;
}

describe("Space Task GitHub issue D1 projection", () => {
  it("reconciles current GitHub links without an earlier snapshot and is case-insensitive", async () => {
    const harness = await createLinkHarness();
    try {
      await projectSpaceTaskGitHubIssueLinks({
        db: harness.db,
        nowMs: 10,
        organizationId: "org-1",
        spaceId: SPACE_ID,
        task,
      });
      await expect(
        listActiveSpaceTaskGitHubIssueLinks({
          db: harness.db,
          number: 1143,
          owner: "amplifthq",
          repo: "openmeld",
        })
      ).resolves.toEqual([
        expect.objectContaining({
          number: 1143,
          ownerLogin: "amplifthq",
          repo: "openmeld",
          spaceId: SPACE_ID,
          taskId: TASK_ID,
        }),
      ]);

      await projectSpaceTaskGitHubIssueLinks({
        db: harness.db,
        nowMs: 20,
        organizationId: "org-1",
        spaceId: SPACE_ID,
        task: {
          ...task,
          externalWorkItems: [{ ...githubItem, number: 1144 }],
        },
      });
      await expect(
        listActiveSpaceTaskGitHubIssueLinks({
          db: harness.db,
          number: 1143,
          owner: "amplifthq",
          repo: "openmeld",
        })
      ).resolves.toEqual([]);
      await expect(
        listActiveSpaceTaskGitHubIssueLinks({
          db: harness.db,
          number: 1144,
          owner: "amplifthq",
          repo: "openmeld",
        })
      ).resolves.toEqual([
        expect.objectContaining({ number: 1144, taskId: TASK_ID }),
      ]);
      await projectSpaceTaskGitHubIssueLinks({
        db: harness.db,
        nowMs: 30,
        organizationId: "org-1",
        spaceId: SPACE_ID,
        task: { ...task, externalWorkItems: [] },
      });
      await expect(
        listActiveSpaceTaskGitHubIssueLinks({
          db: harness.db,
          number: 1144,
          owner: "amplifthq",
          repo: "openmeld",
        })
      ).resolves.toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

describe("GitHub App webhook delivery ledger", () => {
  it("claims a delivery once and reclaims only after the processing claim expires", async () => {
    const harness = await createDeliveryHarness();
    try {
      const first = await claimGitHubAppWebhookDelivery({
        action: "closed",
        claimExpiresAtMs: 1000,
        claimId: "claim-1",
        db: harness.db,
        deliveryId: "delivery-1",
        event: "issues",
        gatewayRequestId: "11111111-1111-4111-8111-111111111111",
        issueState: "closed",
        nowMs: 100,
        number: 1143,
        ownerLogin: "amplifthq",
        receivedAtMs: 100,
        repo: "openmeld",
      });
      const duplicate = await claimGitHubAppWebhookDelivery({
        action: "closed",
        claimExpiresAtMs: 2000,
        claimId: "claim-2",
        db: harness.db,
        deliveryId: "delivery-1",
        event: "issues",
        gatewayRequestId: "22222222-2222-4222-8222-222222222222",
        issueState: "closed",
        nowMs: 200,
        number: 1143,
        ownerLogin: "amplifthq",
        receivedAtMs: 200,
        repo: "openmeld",
      });
      expect(first).toBe("claimed");
      expect(duplicate).toBe("duplicate");

      const expired = await claimGitHubAppWebhookDelivery({
        action: "closed",
        claimExpiresAtMs: 3000,
        claimId: "claim-3",
        db: harness.db,
        deliveryId: "delivery-1",
        event: "issues",
        gatewayRequestId: "33333333-3333-4333-8333-333333333333",
        issueState: "closed",
        nowMs: 1001,
        number: 1143,
        ownerLogin: "amplifthq",
        receivedAtMs: 300,
        repo: "openmeld",
      });
      expect(expired).toBe("claimed");

      await completeGitHubAppWebhookDelivery({
        db: harness.db,
        deliveryId: "delivery-1",
        failureCode: null,
        nowMs: 1100,
        state: "completed",
      });
      await expect(
        claimGitHubAppWebhookDelivery({
          action: "closed",
          claimExpiresAtMs: 4000,
          claimId: "claim-4",
          db: harness.db,
          deliveryId: "delivery-1",
          event: "issues",
          gatewayRequestId: "44444444-4444-4444-8444-444444444444",
          issueState: "closed",
          nowMs: 1200,
          number: 1143,
          ownerLogin: "amplifthq",
          receivedAtMs: 400,
          repo: "openmeld",
        })
      ).resolves.toBe("duplicate");
    } finally {
      await harness.close();
    }
  });
});

describe("GitHub App webhook queue consumer", () => {
  it("observes each linked Space Task once and ignores deliveries with no links", async () => {
    const harness = await createLinkHarness();
    const rpcApplyGitHubIssueObservation = vi.fn(async () => ({
      canceled: true,
      observed: true,
      skipReason: null,
      task,
    }));
    const env = {
      OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      OPENMELD_SPACES: {
        get: () => ({ rpcApplyGitHubIssueObservation }),
        idFromString: (spaceId: string) => spaceId,
      },
    } as never;
    const issue = {
      number: 1143,
      owner: "amplifthq",
      repo: "openmeld",
      state: "closed" as const,
      updatedAt: "2026-09-20T12:00:00.000Z",
      url: "https://github.com/amplifthq/openmeld/issues/1143",
    };
    try {
      await projectSpaceTaskGitHubIssueLinks({
        db: harness.db,
        nowMs: 10,
        organizationId: "org-1",
        spaceId: SPACE_ID,
        task,
      });
      await projectSpaceTaskGitHubIssueLinks({
        db: harness.db,
        nowMs: 11,
        organizationId: "org-1",
        spaceId: OTHER_SPACE_ID,
        task: {
          ...task,
          spaceId: OTHER_SPACE_ID,
          taskId: "tsk_66666666-6666-4666-8666-666666666666",
        },
      });

      await processGitHubAppWebhookQueueMessage({
        env,
        message: {
          deliveryId: "delivery-linked",
          event: "issues",
          gatewayRequestId: "11111111-1111-4111-8111-111111111111",
          issue,
          kind: "github_app_webhook",
          receivedAtMs: 20,
          v: 1,
        },
      });
      expect(rpcApplyGitHubIssueObservation).toHaveBeenCalledTimes(2);
      expect(rpcApplyGitHubIssueObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          observeOperationId: spaceTaskGitHubIssueOperationId(
            "observe-closed",
            issue,
            TASK_ID,
            "delivery-linked"
          ),
          observedState: "closed",
          spaceId: SPACE_ID,
          taskId: TASK_ID,
        })
      );

      rpcApplyGitHubIssueObservation.mockClear();
      await processGitHubAppWebhookQueueMessage({
        env,
        message: {
          deliveryId: "delivery-linked",
          event: "issues",
          gatewayRequestId: "11111111-1111-4111-8111-111111111111",
          issue,
          kind: "github_app_webhook",
          receivedAtMs: 21,
          v: 1,
        },
      });
      expect(rpcApplyGitHubIssueObservation).not.toHaveBeenCalled();

      await processGitHubAppWebhookQueueMessage({
        env,
        message: {
          deliveryId: "delivery-linked-again",
          event: "issues",
          gatewayRequestId: "11111111-1111-4111-8111-111111111111",
          issue: { ...issue, updatedAt: "2026-09-20T14:00:00.000Z" },
          kind: "github_app_webhook",
          receivedAtMs: 22,
          v: 1,
        },
      });
      expect(rpcApplyGitHubIssueObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          observeOperationId: spaceTaskGitHubIssueOperationId(
            "observe-closed",
            issue,
            TASK_ID,
            "delivery-linked-again"
          ),
        })
      );
      rpcApplyGitHubIssueObservation.mockClear();

      await processGitHubAppWebhookQueueMessage({
        env,
        message: {
          deliveryId: "delivery-unlinked",
          event: "issues",
          gatewayRequestId: "11111111-1111-4111-8111-111111111111",
          issue: { ...issue, number: 9999 },
          kind: "github_app_webhook",
          receivedAtMs: 22,
          v: 1,
        },
      });
      expect(rpcApplyGitHubIssueObservation).not.toHaveBeenCalled();
      expect(
        await harness.queryFirst({
          text: 'SELECT state FROM "openmeld"."github_app_webhook_deliveries" WHERE delivery_id = $1',
          values: ["delivery-unlinked"],
        })
      ).toMatchObject({ state: "ignored" });
    } finally {
      await harness.close();
    }
  });
});
