import { describe, expect, it, vi } from "vitest";
import {
  createFeedbackReportingPolicyService,
  type FeedbackReportingPolicyRepository,
} from "../src/feedback/application/feedback-reporting-policy-service";
import { createPostgresFeedbackReportingPolicyRepository } from "../src/feedback/infrastructure/postgresql/feedback-reporting-policy-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Feedback reporting policy service", () => {
  it("defaults a missing organization policy to reporting enabled", async () => {
    const repository: FeedbackReportingPolicyRepository = {
      readPolicy: vi.fn(async () => null),
      upsertPolicy: vi.fn(),
    };
    const service = createFeedbackReportingPolicyService({ repository });

    await expect(
      service.readFeedbackReportingPolicy({ organizationId: "org_feedback" })
    ).resolves.toEqual({
      organizationId: "org_feedback",
      reportingEnabled: true,
      updatedByUserId: null,
    });
  });

  it("persists an explicit opt-out with audit attribution", async () => {
    const repository: FeedbackReportingPolicyRepository = {
      readPolicy: vi.fn(async () => null),
      upsertPolicy: vi.fn(async (input) => ({
        organizationId: input.organizationId,
        reportingEnabled: input.reportingEnabled,
        updatedByUserId: input.updatedByUserId,
      })),
    };
    const service = createFeedbackReportingPolicyService({
      nowMs: () => 2000,
      repository,
    });

    await expect(
      service.setFeedbackReportingPolicy({
        organizationId: "org_feedback",
        reportingEnabled: false,
        updatedByUserId: "user_owner",
      })
    ).resolves.toEqual({
      organizationId: "org_feedback",
      reportingEnabled: false,
      updatedByUserId: "user_owner",
    });
    expect(repository.upsertPolicy).toHaveBeenCalledWith({
      nowMs: 2000,
      organizationId: "org_feedback",
      reportingEnabled: false,
      updatedByUserId: "user_owner",
    });
  });

  it("does not turn a policy storage failure into enabled", async () => {
    const storageError = new Error("D1 policy read failed");
    const service = createFeedbackReportingPolicyService({
      repository: {
        readPolicy: vi.fn(() => Promise.reject(storageError)),
        upsertPolicy: vi.fn(),
      },
    });

    await expect(
      service.readFeedbackReportingPolicy({ organizationId: "org_feedback" })
    ).rejects.toBe(storageError);
  });
});

describe("Feedback reporting policy D1 repository", () => {
  it("round-trips the organization opt-out through migration 0022", async () => {
    const harness = await createPostgresHarness();
    try {
      await seedOrganizationAndUser(harness);
      const service = createFeedbackReportingPolicyService({
        nowMs: () => 3000,
        repository: createPostgresFeedbackReportingPolicyRepository({
          db: harness.db,
        }),
      });

      await expect(
        service.readFeedbackReportingPolicy({ organizationId: "org_feedback" })
      ).resolves.toMatchObject({ reportingEnabled: true });
      await service.setFeedbackReportingPolicy({
        organizationId: "org_feedback",
        reportingEnabled: false,
        updatedByUserId: "user_owner",
      });
      await expect(
        service.readFeedbackReportingPolicy({ organizationId: "org_feedback" })
      ).resolves.toEqual({
        organizationId: "org_feedback",
        reportingEnabled: false,
        updatedByUserId: "user_owner",
      });
    } finally {
      await harness.close();
    }
  });
});

async function seedOrganizationAndUser(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  await harness.query({
    values: ["org_feedback", "Feedback Org", "feedback-org", 1000],
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
  });
  await harness.query({
    values: ["user_owner", "Owner", "owner@example.com"],
    text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
  });
}
