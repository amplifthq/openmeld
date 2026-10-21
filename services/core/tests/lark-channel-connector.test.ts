import { runInDurableObject } from "cloudflare:test";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { encryptLarkPlatformCredential } from "../src/remote-agent/application/lark-platform-credential-crypto";
import { LarkChannelConnector } from "../src/remote-agent/transport/lark/lark-channel-connector";
import {
  decodeLarkFrame,
  encodeLarkFrame,
} from "../src/remote-agent/transport/lark/lark-frame";
import { env } from "../test-support/worker-env";
import message from "../tests-node/fixtures/lark-platform/im-message-receive-v2.json";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe("Lark persistent connector durable handoff", () => {
  it("acknowledges durable acceptance before Queue delivery and recovers the same event after Queue failure", async () => {
    const id = crypto.randomUUID();
    const stub = env.OPENMELD_LARK_CHANNEL_CONNECTOR.getByName(id);
    await runInDurableObject(stub, async (_instance, state) => {
      const cryptoKey = btoa("0123456789abcdef0123456789abcdef");
      const db = getPostgresDatabase(env);
      await db.query({
        ...{
          text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, \'Connector fixture\', $2, 1, 0, 0)',
          values: [],
        },
        values: [id, `${id}@example.com`],
      });
      await db.query({
        ...{
          text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Connector fixture\', $2, 0)',
          values: [],
        },
        values: [id, id],
      });
      await db.query({
        ...{
          text: `INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" (connection_id, organization_id, provider, app_id, tenant_key, bot_open_id, transport, status, installed_by_user_id, permission_bundle_version, granted_capability_groups_json, connection_generation, created_at_ms, updated_at_ms) VALUES ($1, $2, 'lark', $3, $4, 'ou_bot_test', 'websocket', 'connected', $5, 'test', '["conversation.text"]', 1, 0, 0)`,
          values: [],
        },
        values: [id, id, message.header.app_id, message.header.tenant_key, id],
      });
      const encrypted = await encryptLarkPlatformCredential({
        credential: "fixture-secret",
        credentialName: "app secret",
        cryptoKey,
      });
      await db.query({
        ...{
          text: 'INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_channel_credentials" (connection_id, encrypted_app_secret, credential_format_version, created_at_ms, updated_at_ms) VALUES ($1, $2, 1, 0, 0)',
          values: [],
        },
        values: [id, encrypted],
      });
      // biome-ignore lint/correctness/noUndeclaredVariables: Cloudflare runtime global provided by generated Worker types.
      const pair = new WebSocketPair();
      pair[1].accept();
      let upgradeSignal: AbortSignal | null | undefined;
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((url, init) => {
          if (String(url).endsWith("/callback/ws/endpoint")) {
            // Official WS endpoint contract: URL plus heartbeat configuration.
            return Promise.resolve(
              Response.json({
                code: 0,
                data: {
                  URL: "wss://lark.invalid/ws?service_id=7",
                  ClientConfig: { PingInterval: 120 },
                },
              })
            );
          }
          upgradeSignal = init?.signal;
          return Promise.resolve(
            new Response(null, { status: 101, webSocket: pair[0] })
          );
        });
      const queue = {
        send: vi
          .fn()
          .mockRejectedValueOnce(new Error("Queue unavailable"))
          .mockResolvedValue(undefined),
      };
      const connector = new LarkChannelConnector(state, {
        ...env,
        OPENMELD_LARK_CHANNEL_ENABLED: "true",
        OPENMELD_LARK_CHANNEL_ORGANIZATION_IDS: id,
        LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: cryptoKey,
        OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE: queue,
      } as unknown as CoreBindings);
      try {
        expect(await connector.ensureConnected(id)).toBe(true);
        // The HTTP handshake deadline must not cancel an established channel.
        // Keep this real-time boundary: a mocked fetch does not itself close
        // its returned WebSocket when the request's signal later aborts.
        await new Promise((resolve) => setTimeout(resolve, 15_100));
        expect(upgradeSignal).toBeDefined();
        expect(upgradeSignal?.aborted).toBe(false);
        const acknowledgement = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("No provider ACK")),
            2000
          );
          pair[1].addEventListener(
            "message",
            (event) => {
              clearTimeout(timeout);
              const ack = decodeLarkFrame(
                new Uint8Array(event.data as ArrayBuffer)
              );
              expect(
                JSON.parse(new TextDecoder().decode(ack.payload ?? undefined))
              ).toEqual({ code: 200 });
              // Inspect the real Durable Object SQL at the externally visible ACK.
              expect(
                state.storage.sql
                  .exec("SELECT event_id FROM pending_events")
                  .toArray()
              ).toEqual([{ event_id: message.header.event_id }]);
              resolve();
            },
            { once: true }
          );
        });
        pair[1].send(
          encodeLarkFrame({
            SeqID: 42,
            LogID: 123,
            service: 7,
            method: 1,
            headers: [{ key: "type", value: "event" }],
            payload: new TextEncoder().encode(JSON.stringify(message)),
          })
        );
        await acknowledgement;
        await vi.waitFor(() => expect(queue.send).toHaveBeenCalledTimes(1));
        expect(
          state.storage.sql
            .exec("SELECT event_id FROM pending_events")
            .toArray()
        ).toHaveLength(1);
        await connector.alarm();
        expect(queue.send).toHaveBeenCalledTimes(2);
        // A repair changes the generation while previously accepted work is
        // still waiting locally. The new connection cannot execute that work.
        state.storage.sql.exec(
          "INSERT INTO pending_events VALUES (?, 1, ?, ?)",
          "old-generation",
          JSON.stringify({
            ...message,
            header: { ...message.header, event_id: "old-generation" },
          }),
          Date.now()
        );
        await db.query({
          ...{
            text: 'UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" SET connection_generation = 2 WHERE connection_id = $1',
            values: [],
          },
          values: [id],
        });
        await connector.alarm();
        expect(queue.send).toHaveBeenCalledTimes(2);
        expect(
          state.storage.sql
            .exec("SELECT event_id FROM pending_events")
            .toArray()
        ).toHaveLength(0);
        expect(queue.send.mock.calls[1]?.[0]).toMatchObject({
          connectionId: id,
          connectionGeneration: 1,
          providerEventId: message.header.event_id,
        });
        expect(
          state.storage.sql
            .exec("SELECT event_id FROM pending_events")
            .toArray()
        ).toHaveLength(0);
        await connector.alarm();
        expect(queue.send).toHaveBeenCalledTimes(2);
      } finally {
        await connector.disconnect();
        pair[1].close();
        fetchSpy.mockRestore();
        await db.query({
          ...{
            text: 'DELETE FROM "openmeld"."organizations" WHERE id = $1',
            values: [],
          },
          values: [id],
        });
        await db.query({
          ...{
            text: 'DELETE FROM "openmeld"."users" WHERE id = $1',
            values: [],
          },
          values: [id],
        });
      }
    });
  }, 25_000);
});
