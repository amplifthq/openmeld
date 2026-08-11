import assert from "node:assert/strict";
import test from "node:test";
import {
  collectProductionQueueNames,
  verifyProductionQueues,
} from "./verify-production-queues.mjs";

const MISSING_PRODUCTION_ENV_PATTERN =
  /services\/core\/wrangler\.jsonc must declare env\.prod/u;
const MISSING_PRODUCTION_QUEUE_PATTERN =
  /Production Queue "openmeld-message-channel-events" does not exist/u;
const WRANGLER_MISSING_QUEUE_DETAIL_PATTERN =
  /Queue "openmeld-message-channel-events" does not exist\./u;
const QUEUE_PROVISIONING_COMMAND_PATTERN =
  /pnpm exec wrangler queues create openmeld-message-channel-events/u;
const NO_PRODUCTION_QUEUES_PATTERN = /No production Queue bindings were found/u;
const QUEUE_VERIFICATION_FAILED_PATTERN =
  /Production Queue "openmeld-message-channel-events" could not be verified/u;
const RESTORE_ACCESS_PATTERN =
  /Restore Cloudflare credentials or connectivity/u;

test("collects and deduplicates queues from the production environment only", () => {
  const queueNames = collectProductionQueueNames([
    {
      path: "services/core/wrangler.jsonc",
      source: `{
        // Top-level bindings must not be mistaken for production bindings.
        "queues": {
          "producers": [{ "binding": "IGNORED", "queue": "local-only" }],
        },
        "env": {
          "prod": {
            "queues": {
              "producers": [
                { "binding": "DISPATCH", "queue": "openmeld-daemon-dispatch" },
                { "binding": "EVENTS", "queue": "openmeld-message-channel-events" },
              ],
              "consumers": [
                { "queue": "openmeld-message-channel-events" },
                { "queue": "openmeld-daemon-dispatch" },
              ],
            },
          },
        },
      }`,
    },
    {
      path: "services/gateway/wrangler.jsonc",
      source: JSON.stringify({
        env: {
          prod: {
            queues: {
              producers: [
                { binding: "EVENTS", queue: "openmeld-message-channel-events" },
              ],
            },
          },
        },
      }),
    },
  ]);

  assert.deepEqual(queueNames, [
    "openmeld-daemon-dispatch",
    "openmeld-message-channel-events",
  ]);
});

test("rejects a worker config without an explicit production environment", () => {
  assert.throws(
    () =>
      collectProductionQueueNames([
        {
          path: "services/core/wrangler.jsonc",
          source: JSON.stringify({
            queues: {
              producers: [
                { binding: "DISPATCH", queue: "openmeld-daemon-dispatch" },
              ],
            },
          }),
        },
      ]),
    MISSING_PRODUCTION_ENV_PATTERN
  );
});

test("checks every declared production queue and reports the missing resource", async () => {
  const checkedQueueNames = [];

  await assert.rejects(
    verifyProductionQueues({
      queueNames: [
        "openmeld-daemon-dispatch",
        "openmeld-message-channel-events",
      ],
      runQueueInfo: (queueName) => {
        checkedQueueNames.push(queueName);
        if (queueName === "openmeld-message-channel-events") {
          return Promise.reject(
            new Error('Queue "openmeld-message-channel-events" does not exist.')
          );
        }
        return Promise.resolve();
      },
    }),
    (error) => {
      assert.match(error.message, MISSING_PRODUCTION_QUEUE_PATTERN);
      assert.match(error.message, WRANGLER_MISSING_QUEUE_DETAIL_PATTERN);
      assert.match(error.message, QUEUE_PROVISIONING_COMMAND_PATTERN);
      return true;
    }
  );

  assert.deepEqual(checkedQueueNames, [
    "openmeld-daemon-dispatch",
    "openmeld-message-channel-events",
  ]);
});

test("does not misdiagnose authentication or network failures as a missing Queue", async () => {
  for (const detail of [
    "Authentication error [code: 10000]",
    "getaddrinfo ENOTFOUND api.cloudflare.com",
  ]) {
    await assert.rejects(
      verifyProductionQueues({
        queueNames: ["openmeld-message-channel-events"],
        runQueueInfo: () => Promise.reject(new Error(detail)),
      }),
      (error) => {
        assert.match(error.message, QUEUE_VERIFICATION_FAILED_PATTERN);
        assert.match(error.message, RESTORE_ACCESS_PATTERN);
        assert.ok(error.message.includes(detail));
        assert.doesNotMatch(error.message, QUEUE_PROVISIONING_COMMAND_PATTERN);
        return true;
      }
    );
  }
});

test("requires at least one production queue to verify", async () => {
  await assert.rejects(
    verifyProductionQueues({
      queueNames: [],
      runQueueInfo: () => Promise.reject(new Error("must not run")),
    }),
    NO_PRODUCTION_QUEUES_PATTERN
  );
});
