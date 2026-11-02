import { createRequire } from "node:module";
import {
  EdgeTypeSchema,
  EntityFields,
  type EntityPropertyType,
  EntityTypeSchema,
  edgeModelToAPISchema,
  entityFields,
} from "@getzep/zep-cloud";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { z } from "zod/v4";
import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
} from "../src/center-agent-memory/contract";
import { createZepCenterAgentMemoryAdapter } from "../src/center-agent-memory/zep-memory-adapter";

const require = createRequire(import.meta.url);
const esm = {
  EdgeTypeSchema,
  EntityFields,
  EntityTypeSchema,
  edgeModelToAPISchema,
  entityFields,
};

describe("Zep ontology compatibility with the shared Zod runtime", () => {
  test.each([
    ["ESM", esm],
    ["CommonJS", require("@getzep/zep-cloud") as typeof esm],
  ])("%s preserves typed field dictionaries and edge source targets", (_, zep) => {
    const fields = {
      label: zep.entityFields.text("Display label"),
      count: zep.entityFields.integer("Count"),
      score: zep.entityFields.float("Score"),
      active: zep.entityFields.boolean("Enabled"),
    };
    const entity = zep.EntityTypeSchema.parse({ fields });
    expectTypeOf(entity.fields).toEqualTypeOf<
      Record<
        string,
        | {
            type: EntityPropertyType.Text;
            description: string;
            value?: string;
          }
        | {
            type: EntityPropertyType.Int;
            description: string;
            value?: number;
          }
        | {
            type: EntityPropertyType.Float;
            description: string;
            value?: number;
          }
        | {
            type: EntityPropertyType.Boolean;
            description: string;
            value?: boolean;
          }
      >
    >();
    expect(entity).toEqual({ description: "", fields });
    expect(zep.EntityFields.parse(fields)).toEqual(fields);
    expect(zep.EntityTypeSchema).toBeInstanceOf(z.ZodType);
    expect(
      zep.EntityTypeSchema.safeParse({ fields: { bad: { type: "Unknown" } } })
        .success
    ).toBe(false);

    const sourceTargets = [{ source: "Person", target: "Project" }, {}];
    const edge = zep.EdgeTypeSchema.parse({ fields, sourceTargets });
    expect(edge).toEqual({ description: "", fields, sourceTargets });
    expect(zep.edgeModelToAPISchema(edge, "works_on")).toEqual({
      name: "works_on",
      description: "",
      sourceTargets,
      properties: Object.entries(fields).map(([name, field]) => ({
        name,
        type: field.type,
        description: field.description,
      })),
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("the packaged Zep runtime writes and recalls member and organization memory through the existing v2 API", async () => {
  const occurredAtMs = Date.UTC(2026, 0, 1);
  const metadata = {
    openmeld_memory_version: 1,
    openmeld_memory_capture_method: "automatic_turn",
    openmeld_memory_occurred_at_ms: occurredAtMs,
    openmeld_memory_source: "ca_dm",
    openmeld_memory_source_conversation_id: "dm_1",
    openmeld_memory_source_message_id: "signal_1",
  };
  // Wire fields follow Zep's published Episode and EntityEdge response schemas.
  const episode = {
    uuid: "episode_1",
    created_at: "2026-01-01T00:00:00Z",
    content: "Calibration code is cobalt-719.",
    metadata,
    processed: false,
  };
  const results = {
    edges: [
      {
        uuid: "edge_1",
        created_at: episode.created_at,
        source_node_uuid: "node_1",
        target_node_uuid: "node_2",
        name: "calibration_code",
        fact: "Calibration code is cobalt-719.",
        episodes: [episode.uuid],
      },
    ],
  };
  const responses: Record<string, unknown> = {
    "POST /api/v2/users": { user_id: "member_1" },
    "POST /api/v2/graph/create": { graph_id: "organization_1" },
    "POST /api/v2/graph": episode,
    "POST /api/v2/graph/search": results,
    "GET /api/v2/graph/episodes/episode_1": { ...episode, processed: true },
    "DELETE /api/v2/users/org%3Aorg_1%3Amember%3Auser_1": {
      message: "deleted",
    },
    "DELETE /api/v2/graph/org%3Aorg_1%3Acenter-agent": { message: "deleted" },
  };
  const requests: { route: string; body: Record<string, unknown> | null }[] =
    [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((url, init) => {
      const route = `${init?.method ?? "GET"} ${new URL(String(url)).pathname}`;
      expect(responses).toHaveProperty(route);
      requests.push({
        route,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Promise.resolve(Response.json(responses[route]));
    })
  );
  const adapter = createZepCenterAgentMemoryAdapter({
    apiKey: "offline-sdk-fixture",
  });
  const member = buildCenterAgentMemberMemoryRef({
    organizationId: "org_1",
    memberId: "member_1",
    userId: "user_1",
  });
  const organization = buildCenterAgentOrganizationMemoryRef({
    organizationId: "org_1",
  });
  await adapter.ensureMemberUser(member);
  await adapter.ensureOrganizationGraph(organization);
  for (const ref of [member, organization]) {
    await expect(
      adapter.addEpisode({
        ref,
        episode: {
          source: "ca_dm",
          sourceConversationId: "dm_1",
          sourceMessageId: "signal_1",
          captureMethod: "automatic_turn",
          occurredAtMs,
          userMessage: episode.content,
          assistantMessage: "Recorded.",
        },
      })
    ).resolves.toEqual({ episodeId: "episode_1", processed: false });
    const found = await adapter.searchDetailed({
      ref,
      query: "calibration code",
      limit: 2,
    });
    expect(found).toMatchObject({
      status: "complete",
      items: [
        {
          text: expect.stringContaining("cobalt-719"),
          sources: [
            expect.objectContaining({
              source: "ca_dm",
              sourceConversationId: "dm_1",
              sourceMessageId: "signal_1",
              occurredAtMs,
              captureMethod: "automatic_turn",
            }),
          ],
        },
      ],
    });
  }
  await expect(adapter.deleteMemberUser(member)).resolves.toBe("deleted");
  await expect(adapter.deleteOrganizationGraph(organization)).resolves.toBe(
    "deleted"
  );

  expect(
    requests.filter((r) => r.route === "POST /api/v2/graph").map((r) => r.body)
  ).toEqual([
    expect.objectContaining({
      user_id: "org:org_1:member:user_1",
      type: "message",
      metadata,
    }),
    expect.objectContaining({
      graph_id: "org:org_1:center-agent",
      type: "message",
      metadata,
    }),
  ]);
  expect(
    requests
      .filter((r) => r.route === "POST /api/v2/graph/search")
      .map((r) => r.body)
  ).toEqual([
    {
      user_id: "org:org_1:member:user_1",
      query: "calibration code",
      scope: "edges",
      limit: 2,
    },
    {
      graph_id: "org:org_1:center-agent",
      query: "calibration code",
      scope: "edges",
      limit: 2,
    },
  ]);
});
