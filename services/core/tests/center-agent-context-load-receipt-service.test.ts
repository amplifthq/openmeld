import type { CenterAgentContextManifestMaterialization } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  areCenterAgentContextLoadSelectionsEqual,
  resolveCenterAgentContextLoadSelection,
} from "../src/center-agent/application/center-agent-context-load-receipt-service";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

describe("Center Agent Context Load Receipt", () => {
  it("canonicalizes an exact subset in manifest order and totals its tokens", () => {
    const result = resolveCenterAgentContextLoadSelection({
      manifestClient: "codex",
      materializations: [
        materialization({ estimatedTokens: 20, hash: HASH_A, id: "signal-a" }),
        materialization({ estimatedTokens: 30, hash: HASH_B, id: "signal-b" }),
      ],
      reportedClient: "codex",
      selection: {
        entries: [
          { materializedContentHash: HASH_B, sourceRefId: "signal-b" },
          { materializedContentHash: HASH_A, sourceRefId: "signal-a" },
        ],
        kind: "selected_entries",
      },
    });

    expect(result).toEqual({
      estimatedTokens: 50,
      selectedEntries: [
        { materializedContentHash: HASH_A, sourceRefId: "signal-a" },
        { materializedContentHash: HASH_B, sourceRefId: "signal-b" },
      ],
    });
  });

  it("supports all materialized entries without trusting caller-provided counts", () => {
    expect(
      resolveCenterAgentContextLoadSelection({
        manifestClient: "claude-code",
        materializations: [
          materialization({
            estimatedTokens: 20,
            hash: HASH_A,
            id: "signal-a",
          }),
        ],
        reportedClient: "claude-code",
        selection: { kind: "all_manifest_entries" },
      })
    ).toEqual({
      estimatedTokens: 20,
      selectedEntries: [
        { materializedContentHash: HASH_A, sourceRefId: "signal-a" },
      ],
    });
  });

  it("rejects a different client, duplicate entry, or forged hash", () => {
    const materializations = [
      materialization({ estimatedTokens: 20, hash: HASH_A, id: "signal-a" }),
    ];
    expect(() =>
      resolveCenterAgentContextLoadSelection({
        manifestClient: "codex",
        materializations,
        reportedClient: "claude-code",
        selection: { kind: "all_manifest_entries" },
      })
    ).toThrow("must match the client");
    expect(() =>
      resolveCenterAgentContextLoadSelection({
        manifestClient: "codex",
        materializations,
        reportedClient: "codex",
        selection: {
          entries: [
            { materializedContentHash: HASH_A, sourceRefId: "signal-a" },
            { materializedContentHash: HASH_A, sourceRefId: "signal-a" },
          ],
          kind: "selected_entries",
        },
      })
    ).toThrow("only once");
    expect(() =>
      resolveCenterAgentContextLoadSelection({
        manifestClient: "codex",
        materializations,
        reportedClient: "codex",
        selection: {
          entries: [
            { materializedContentHash: HASH_B, sourceRefId: "signal-a" },
          ],
          kind: "selected_entries",
        },
      })
    ).toThrow("exactly match");
  });

  it("compares canonical selections for idempotent retries", () => {
    const selected = [
      { materializedContentHash: HASH_A, sourceRefId: "signal-a" },
    ];
    expect(
      areCenterAgentContextLoadSelectionsEqual(selected, [...selected])
    ).toBe(true);
    expect(
      areCenterAgentContextLoadSelectionsEqual(selected, [
        { materializedContentHash: HASH_B, sourceRefId: "signal-a" },
      ])
    ).toBe(false);
  });
});

function materialization(input: {
  estimatedTokens: number;
  hash: `sha256:${string}`;
  id: string;
}): CenterAgentContextManifestMaterialization {
  return {
    estimatedTokens: input.estimatedTokens,
    materializedContentHash: input.hash,
    sourceRef: {
      id: input.id,
      type: "space_signal",
      uri: `openmeld://spaces/space-1/signals/${input.id}`,
      version: input.hash,
    },
  };
}
