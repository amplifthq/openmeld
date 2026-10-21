import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it, vi } from "vitest";
import type { CenterAgentMemoryAdapter } from "../src/center-agent-memory/contract";
import { createCenterAgentMemoryService } from "../src/center-agent-memory/memory-service";
import { createPostgresCenterAgentMemoryRepository } from "../src/center-agent-memory/postgresql-memory-repository";
import { env } from "../test-support/worker-env";

describe("automatic memory recall with persisted subject state", () => {
  it.each([
    "delete",
    "opt-out",
  ] as const)("does not inject a result after %s while the provider is pending", async (change) => {
    const fixture = await seedMemorySubject();
    let providerStarted!: () => void;
    let releaseProvider!: () => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const adapter: CenterAgentMemoryAdapter = {
      ensureMemberUser: vi.fn(),
      ensureOrganizationGraph: vi.fn(),
      addEpisode: vi.fn(),
      deleteMemberUser: vi.fn(),
      deleteOrganizationGraph: vi.fn(),
      search: async () => {
        providerStarted();
        await released;
        return [
          {
            text: "Cedar Kite reports use a table.",
            captureMethod: "explicit_save",
            source: "ca_dm",
            occurredAtMs: 1000,
            sourceConversationId: "synthetic-conversation",
            sourceMessageId: "synthetic-message",
            subject: "organization",
          },
        ];
      },
    };
    const service = createCenterAgentMemoryService({
      adapter,
      repository: fixture.repository,
    });
    const recall = service.recallForOrganization({
      organizationId: fixture.organizationId,
      query: "Cedar Kite report",
    });
    await started;
    if (change === "delete") {
      await fixture.repository.markOrganizationDeleted({
        organizationId: fixture.organizationId,
        deletedAtMs: 2000,
      });
    } else {
      await fixture.repository.upsertPolicy({
        organizationId: fixture.organizationId,
        organizationMemoryOptIn: false,
        updatedByUserId: fixture.userId,
        nowMs: 2000,
      });
    }
    const before = await fixture.readRows();
    releaseProvider();
    expect(await recall).toEqual({ items: [], truncated: false });
    expect(await fixture.readRows()).toEqual(before);
    expect(adapter.ensureOrganizationGraph).not.toHaveBeenCalled();
    expect(adapter.addEpisode).not.toHaveBeenCalled();
  });

  it("leaves a deleted subject deleted when a new recall begins", async () => {
    const fixture = await seedMemorySubject();
    await fixture.repository.markOrganizationDeleted({
      organizationId: fixture.organizationId,
      deletedAtMs: 2000,
    });
    const before = await fixture.readRows();
    expect(
      await fixture.repository.readActiveSubjects({
        organizationId: fixture.organizationId,
      })
    ).toEqual([]);
    expect(await fixture.readRows()).toEqual(before);
  });
});

async function seedMemorySubject() {
  const id = crypto.randomUUID();
  const organizationId = `memory_org_${id}`;
  const userId = `memory_user_${id}`;
  await getPostgresDatabase(env).query({
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
    values: [organizationId, "Synthetic memory evaluation", id, 1000],
  });
  await getPostgresDatabase(env).query({
    text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    values: [userId, "Synthetic evaluator", `${id}@example.com`, 1, 1000, 1000],
  });
  const repository = createPostgresCenterAgentMemoryRepository(
    getPostgresDatabase(env)
  );
  await repository.upsertOrganizationSubject({ organizationId, nowMs: 1000 });
  return {
    organizationId,
    userId,
    repository,
    readRows: async () =>
      (
        await getPostgresDatabase(env).query({
          text: 'SELECT * FROM "openmeld"."center_agent_memory_subjects" WHERE organization_id = $1',
          values: [organizationId],
        })
      ).rows,
  };
}
