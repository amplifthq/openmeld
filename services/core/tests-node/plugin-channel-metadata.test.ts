import {
  buildOpenMeldNavigationAction,
  navigationActionSchema,
  type PluginChannelSelection,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { preparePluginChannelNavigation } from "../src/connectors/plugin-channel-navigation";
import {
  assertPluginChannelSourceUnchanged,
  buildPluginChannelSourceProof,
} from "../src/remote-agent/application/plugin-channel-source-proof";
import type { RemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  bindPluginChannelExecution,
  issuePluginChannelIntent,
  readPluginChannelMetadata,
  recordPluginChannelSource,
  selectPluginChannelAccount,
} from "../src/remote-agent/infrastructure/d1/plugin-channel-metadata-repo";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const harnesses: ReturnType<typeof createSqliteD1Harness>[] = [];
function fixture() {
  const h = createSqliteD1Harness();
  harnesses.push(h);
  // Apply the actual generated native-delivery schema, including its additive
  // metadata column; no shadow table or mock compare-and-set implementation.
  applyDrizzleMigrationsForTables(h, [
    "openMeldRemoteAgent_native_delivery_ledger",
  ]);
  h.run({
    sql: `INSERT INTO openMeldRemoteAgent_native_delivery_ledger (delivery_id, organization_id, conversation_kind, space_id, profile_id, binding_id, trigger_message_id, dispatch_id, idempotency_key, status, created_at_ms, updated_at_ms) VALUES ('source','org','slack','conversation','agent','binding','message','dispatch','source','completed',1,2)`,
  });
  h.run({
    sql: `INSERT INTO openMeldRemoteAgent_native_delivery_ledger (delivery_id, organization_id, conversation_kind, space_id, profile_id, binding_id, trigger_message_id, dispatch_id, idempotency_key, status, created_at_ms, updated_at_ms) VALUES ('next','org','slack','conversation','agent','binding','message','next','next','submitted',2,3)`,
  });
  return h;
}
const selection: PluginChannelSelection = {
  sourceDeliveryId: "source",
  organizationId: "org",
  requesterUserId: "user",
  requesterProfileId: "human",
  targetProfileId: "agent",
  service: "github",
  scope: "shared",
  connectionName: "org-github",
  connectionUpdatedAtMs: 42,
  continuationTriggerId: "plugin-channel-continue:one",
};
const input = {
  provider: "slack" as const,
  messageId: "message",
  providerUserId: "slack-user",
  text: "Check repository",
  resourceIds: ["file-1", "file-2"],
};
afterEach(() => {
  for (const h of harnesses.splice(0)) {
    h.close();
  }
});
describe("Plugin channel metadata is immutable native-delivery state", () => {
  it("keeps legacy rows unbound and rejects missing or corrupt proof rather than fabricating authority", async () => {
    const h = fixture();
    expect(await readPluginChannelMetadata(h.db, "source")).toBeNull();
    await expect(
      issuePluginChannelIntent(h.db, "source", {
        service: "github",
        scope: "choose",
        expiresAtMs: 999,
      })
    ).rejects.toThrow("source_proof_unavailable");
    await expect(readPluginChannelMetadata(h.db, "missing")).rejects.toThrow(
      "delivery_unavailable"
    );
    h.run({
      sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET plugin_connection_metadata_json = '{}' WHERE delivery_id = 'source'",
    });
    await expect(readPluginChannelMetadata(h.db, "source")).rejects.toThrow();
  });
  it("uses a private request locator only when the original proof was admitted, preserving the normal navigation contract", async () => {
    const h = fixture();
    const action = buildOpenMeldNavigationAction({
      organizationWebUrl: "https://openmeld.ai/o/acme",
      target: { kind: "plugin_connection", service: "github", scope: "choose" },
    });
    const delivery = {
      deliveryId: "source",
      completedAtMs: 100,
    } as RemoteAgentNativeDeliveryRecord;
    expect(
      await preparePluginChannelNavigation({ db: h.db, delivery, action })
    ).toEqual(action);
    await recordPluginChannelSource(
      h.db,
      "source",
      await buildPluginChannelSourceProof(input)
    );
    const guided = navigationActionSchema.parse(
      await preparePluginChannelNavigation({ db: h.db, delivery, action })
    );
    expect(guided.target).toEqual(action.target);
    expect(new URL(guided.url).searchParams.get("request")).toBe("source");
    expect(new URL(guided.url).pathname).toBe(new URL(action.url).pathname);
    expect(await readPluginChannelMetadata(h.db, "source")).toMatchObject({
      intent: { service: "github", scope: "choose", expiresAtMs: 86_400_100 },
    });
  });

  it("captures the original source once, prevents refreshed proofs, and never extends the original intent expiry", async () => {
    const h = fixture();
    const proof = await buildPluginChannelSourceProof(input);
    await recordPluginChannelSource(h.db, "source", proof);
    await recordPluginChannelSource(h.db, "source", proof);
    await expect(
      recordPluginChannelSource(h.db, "source", {
        ...proof,
        revision: "edited",
      })
    ).rejects.toThrow("source_conflict");
    await issuePluginChannelIntent(h.db, "source", {
      service: "github",
      scope: "choose",
      expiresAtMs: 999,
    });
    await issuePluginChannelIntent(h.db, "source", {
      service: "github",
      scope: "choose",
      expiresAtMs: 1999,
    });
    expect(await readPluginChannelMetadata(h.db, "source")).toMatchObject({
      proof,
      intent: { expiresAtMs: 999 },
    });
  });
  it("concurrent account selections accept at most one exact scope/name/version", async () => {
    const h = fixture();
    await recordPluginChannelSource(
      h.db,
      "source",
      await buildPluginChannelSourceProof(input)
    );
    await issuePluginChannelIntent(h.db, "source", {
      service: "github",
      scope: "choose",
      expiresAtMs: 999,
    });
    const results = await Promise.allSettled([
      selectPluginChannelAccount(h.db, "source", selection),
      selectPluginChannelAccount(h.db, "source", {
        ...selection,
        scope: "member",
        connectionName: "my-github",
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const stored = await readPluginChannelMetadata(h.db, "source");
    if (!stored?.selection) {
      throw new Error("Expected one accepted account");
    }
    expect(
      await selectPluginChannelAccount(h.db, "source", stored.selection)
    ).toEqual(stored.selection);
    await expect(
      selectPluginChannelAccount(h.db, "source", {
        ...stored.selection,
        connectionUpdatedAtMs: 43,
      })
    ).rejects.toThrow("selection_conflict");
  });
  it("a second Plugin request preserves original proof and first execution binding, including retries of the first admission", async () => {
    const h = fixture();
    const proof = await buildPluginChannelSourceProof(input);
    await bindPluginChannelExecution(h.db, "next", selection, proof);
    await issuePluginChannelIntent(h.db, "next", {
      service: "linear",
      scope: "member",
      expiresAtMs: 999,
    });
    const second = {
      ...selection,
      sourceDeliveryId: "next",
      service: "linear" as const,
      scope: "member" as const,
      connectionName: "my-linear",
      continuationTriggerId: "plugin-channel-continue:two",
    };
    await selectPluginChannelAccount(h.db, "next", second);
    await bindPluginChannelExecution(h.db, "next", selection, proof);
    expect(await readPluginChannelMetadata(h.db, "next")).toMatchObject({
      kind: "continuation",
      executionSelection: selection,
      selection: second,
      proof,
    });
    await expect(
      bindPluginChannelExecution(
        h.db,
        "next",
        { ...selection, connectionName: "other" },
        proof
      )
    ).rejects.toThrow("execution_binding_conflict");
  });
  it("checks text, resource identity, author, and edit revision without relying on clipped history", async () => {
    const proof = await buildPluginChannelSourceProof({
      ...input,
      text: `prefix${"x".repeat(20_000)}MIDDLE${"y".repeat(20_000)}`,
    });
    for (const other of [
      null,
      { ...proof, revision: "edited" },
      { ...proof, providerUserId: "other" },
      await buildPluginChannelSourceProof({
        ...input,
        resourceIds: ["replacement"],
      }),
    ]) {
      expect(() => assertPluginChannelSourceUnchanged(proof, other)).toThrow(
        "original_request_changed"
      );
    }
    expect(() =>
      assertPluginChannelSourceUnchanged(proof, proof)
    ).not.toThrow();
    expect(
      await buildPluginChannelSourceProof({
        ...input,
        resourceIds: ["file-2", "file-1", "file-1"],
      })
    ).toEqual(await buildPluginChannelSourceProof(input));
  });
});
