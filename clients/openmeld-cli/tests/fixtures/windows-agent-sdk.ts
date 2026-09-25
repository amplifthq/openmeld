// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone protocol peer; assertions fail its process, and test-runner stdout would corrupt the protocol.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type {
  SDKControlInitializeResponse,
  SDKControlResponse,
  SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";

// A protocol peer built against the installed vendor's exported types. The
// caller uses the real SDK and OpenMeld Windows launcher, without API credentials
// or model inference. Unexpected requests fail instead of inventing responses.
const input = createInterface({ input: process.stdin });
let initialized = false;
for await (const line of input) {
  const message = JSON.parse(line);
  if (message.type === "control_request") {
    assert.equal(message.request.subtype, "initialize");
    const response: SDKControlInitializeResponse = {
      commands: [],
      agents: [],
      models: [],
      account: {},
      output_style: "default",
      available_output_styles: ["default"],
    };
    const reply: SDKControlResponse = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: message.request_id,
        response,
      },
    };
    process.stdout.write(`${JSON.stringify(reply)}\n`);
    initialized = true;
  } else {
    assert.equal(message.type, "user");
    assert.ok(initialized);
    assert.equal(message.message.content, "fixture request: 中文 & spaces");
    console.error("fixture stderr: 中文");
    const reply: SDKResultSuccess = {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "fixture response: 中文 & spaces",
      session_id: "e09a1234-11d2-4efd-9d80-72cc8fb1ea08",
      uuid: randomUUID(),
      duration_ms: 1,
      duration_api_ms: 0,
      num_turns: 1,
      stop_reason: "end_turn",
      total_cost_usd: 0,
      modelUsage: {},
      permission_denials: [],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: {
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 0,
        },
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        inference_geo: "us",
        iterations: [],
        service_tier: "standard",
        speed: "standard",
      },
    };
    process.stdout.write(`${JSON.stringify(reply)}\n`);
    break;
  }
}
input.close();
process.stdin.destroy();
