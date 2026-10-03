import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { CenterAgentMemoryAdapter } from "../src/center-agent-memory/contract";
import { createD1CenterAgentMemoryRepository } from "../src/center-agent-memory/d1-memory-repository";
import { createCenterAgentMemoryService } from "../src/center-agent-memory/memory-service";

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
  await env.OPENMELD_DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(organizationId, "Synthetic memory evaluation", id, 1000)
    .run();
  await env.OPENMELD_DB.prepare(
    "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(userId, "Synthetic evaluator", `${id}@example.com`, 1, 1000, 1000)
    .run();
  const repository = createD1CenterAgentMemoryRepository(env.OPENMELD_DB);
  await repository.upsertOrganizationSubject({ organizationId, nowMs: 1000 });
  return {
    organizationId,
    userId,
    repository,
    readRows: async () =>
      (
        await env.OPENMELD_DB.prepare(
          "SELECT * FROM center_agent_memory_subjects WHERE organization_id = ?"
        )
          .bind(organizationId)
          .all()
      ).results,
  };
}
