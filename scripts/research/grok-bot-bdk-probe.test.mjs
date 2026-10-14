import assert from "node:assert/strict";
import test from "node:test";
import { probeGrokBotSession } from "./grok-bot-bdk-probe.mjs";

const PRIVATE_OUTPUT = /PRIVATE_|TEST_SECRET/u;

// Captured from the official BDK 0.2.24 API on 2026-10-14. Content and
// cursor values are replaced; field names and response structure are retained.
const capturedPage = {
  entries: [
    {
      seq: "1",
      updatedSeq: "1",
      kind: "message",
      role: "user",
      text: "PRIVATE_TRANSCRIPT",
      createdAtMs: 1,
    },
    {
      seq: "2",
      updatedSeq: "2",
      kind: "send-message",
      text: "PRIVATE_REPLY",
      createdAtMs: 2,
    },
  ],
  latestUpdatedSeq: "2",
  turn: { idle: true, inFlight: false, queued: 0 },
};

test("reads only the pinned session and excludes transcript and credentials", async () => {
  const calls = [];
  const result = await probeGrokBotSession({
    apiKey: "TEST_SECRET",
    sessionId: "123",
    afterUpdatedSeq: "0",
    fetchImpl(url, options) {
      calls.push({ url, options });
      return Promise.resolve(Response.json(capturedPage));
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.cursor.com/v0/grokbot/sessions/123/entries?afterUpdatedSeq=0"
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(result.entryCount, 2);
  assert.deepEqual(result.turnFields, ["idle", "inFlight", "queued"]);
  assert.equal(result.purpose, "protocol_observation_only");
  assert.doesNotMatch(JSON.stringify(result), PRIVATE_OUTPUT);
});

test("invalid identity and cursor cannot make a request", async () => {
  for (const [sessionId, afterUpdatedSeq] of [
    ["../other", "0"],
    ["123", undefined],
    ["123", "0&secret=value"],
  ]) {
    await assert.rejects(
      probeGrokBotSession({
        apiKey: "TEST_SECRET",
        sessionId,
        afterUpdatedSeq,
        fetchImpl() {
          assert.fail("Invalid input must not reach the API.");
        },
      })
    );
  }
});

test("HTTP errors and malformed provider responses fail without private output", async () => {
  for (const response of [
    new Response("PRIVATE_ACCOUNT_ERROR TEST_SECRET", { status: 401 }),
    new Response("PRIVATE_MALFORMED_JSON"),
    Response.json({ ...capturedPage, turn: { idle: true } }),
  ]) {
    await assert.rejects(
      probeGrokBotSession({
        apiKey: "TEST_SECRET",
        sessionId: "123",
        afterUpdatedSeq: "0",
        fetchImpl: () => Promise.resolve(response),
      }),
      (error) => !PRIVATE_OUTPUT.test(error.message)
    );
  }
});
