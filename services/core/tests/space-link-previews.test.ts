import { runInDurableObject } from "cloudflare:test";
import type { SignalEnvelope } from "@openmeld/protocol";
import { createAnonymousViewerSpaceAccessContext } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import { env } from "../test-support/worker-env";

describe("Space-owned link preview source", () => {
  it("uses current stored content, rejects recalled messages, and rechecks Space access", async () => {
    const namespace = (env as CoreBindings).OPENMELD_SPACES;
    const id = namespace.newUniqueId();
    const spaceId = id.toString();
    const stub = namespace.get(id);
    const spaceAccess = createAnonymousViewerSpaceAccessContext({
      spaceId,
      requestId: "link-preview-test",
    });
    await runInDurableObject(stub, async (instance, state) => {
      const now = new Date().toISOString();
      const meta = {
        v: 1 as const,
        spaceId,
        organizationId: "preview-test",
        visibility: "public" as const,
        accessMode: "public" as const,
        createdAt: now,
        updatedAt: now,
      };
      upsertSpaceMetaRecord(state.storage.sql, meta);
      const signal: SignalEnvelope = {
        v: 1,
        id: "link-message",
        spaceId,
        ts: Date.now(),
        type: "signal.text",
        profile: { kind: "human", profileId: "reader" },
        data: {
          text: "https://example.com/original",
          meta: { messageRevision: 0 },
        },
      };
      insertSignalRecord(state.storage.sql, signal);
      const input = { spaceId, signalId: signal.id, spaceAccess };
      expect(await instance.rpcGetMessageLinks(input)).toMatchObject({
        revision: 0,
        urls: ["https://example.com/original"],
      });
      signal.data.text = "[Updated](https://example.com/updated)";
      signal.data.meta = { messageRevision: 1 };
      state.storage.sql.exec(
        "UPDATE space_signals SET payload_json = ? WHERE id = ?",
        JSON.stringify(signal),
        signal.id
      );
      expect(await instance.rpcGetMessageLinks(input)).toMatchObject({
        revision: 1,
        urls: ["https://example.com/updated"],
      });
      signal.data.meta = { messageRevision: 2, recalledAt: Date.now() };
      state.storage.sql.exec(
        "UPDATE space_signals SET payload_json = ? WHERE id = ?",
        JSON.stringify(signal),
        signal.id
      );
      await expect(instance.rpcGetMessageLinks(input)).rejects.toThrow(
        "This message is no longer available."
      );
      upsertSpaceMetaRecord(state.storage.sql, {
        ...meta,
        accessMode: "members_only",
      });
      await expect(instance.rpcGetMessageLinks(input)).rejects.toThrow();
    });
  });
});
