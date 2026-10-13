"use strict";
// Initialize captured from Google's Antigravity ACP 1.3.0 binary. Session and
// permission payloads follow @agentclientprotocol/sdk 1.7.0's v1 wire types.
const { appendFileSync } = require("node:fs");
const { createInterface } = require("node:readline");
const scenario = process.env.FIXTURE_SCENARIO;
const sessionId = "agy_session";
const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const update = (content) =>
  send({
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: content },
      },
    },
  });
let promptId;
const finish = () => {
  update("Native Antigravity reply");
  send({ id: promptId, result: { stopReason: "end_turn" } });
};
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Explicit wire responses keep this protocol fixture independently readable.
(async () => {
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line);
    if (process.env.FIXTURE_LOG) {
      appendFileSync(process.env.FIXTURE_LOG, `${JSON.stringify(message)}\n`);
    }
    if (message.id === "permission_request") {
      finish();
      continue;
    }
    const { id, method } = message;
    if (method === "initialize") {
      send({
        id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: {
              image: true,
              audio: true,
              embeddedContext: true,
            },
            mcpCapabilities: { http: true, sse: true },
            sessionCapabilities: { list: {}, resume: {} },
            auth: { logout: {} },
          },
          authMethods: [{ id: "oauth-personal", name: "Log in with Google" }],
          agentInfo: { name: "antigravity-acp", version: "1.3.0" },
        },
      });
    } else if (method === "authenticate") {
      send(
        scenario === "auth"
          ? { id, error: { code: -32_000, message: "Authentication required" } }
          : { id, result: {} }
      );
    } else if (method === "session/new" || method === "session/resume") {
      if (scenario === "context-missing" && method === "session/resume") {
        send({
          id,
          error: { code: -32_602, message: "Session was not found" },
        });
        continue;
      }
      if (scenario === "auth") {
        send({
          id,
          error: { code: -32_000, message: "Authentication required" },
        });
        continue;
      }
      update("Old history must not be published");
      send({
        id,
        result: {
          sessionId,
          modes: {
            currentModeId: "default",
            availableModes: [
              { id: "default", name: "Default" },
              { id: "auto_edit", name: "Auto edit" },
              { id: "yolo", name: "YOLO" },
            ],
          },
          configOptions: [
            {
              id: "model",
              name: "Model",
              type: "select",
              currentValue: "native-model",
              options: [{ value: "native-model", name: "Native model" }],
            },
          ],
        },
      });
    } else if (
      method === "session/set_mode" ||
      method === "session/set_config_option"
    ) {
      send({ id, result: {} });
    } else if (method === "session/prompt") {
      promptId = id;
      if (scenario === "cancel") {
        update("Working");
        continue;
      }
      if (["permission", "question", "no-channel"].includes(scenario)) {
        send({
          id: "permission_request",
          method: "session/request_permission",
          params: {
            sessionId,
            toolCall: {
              toolCallId: scenario === "question" ? "interaction_1" : "tool_1",
              title:
                scenario === "question" ? "Choose a format" : "Run git status?",
              kind: "execute",
            },
            options:
              scenario === "question"
                ? [
                    { optionId: "md", name: "Markdown", kind: "allow_once" },
                    { optionId: "txt", name: "Plain text", kind: "allow_once" },
                  ]
                : [
                    {
                      optionId: "once",
                      name: "Allow once",
                      kind: "allow_once",
                    },
                    {
                      optionId: "thread",
                      name: "Always allow",
                      kind: "allow_always",
                      _meta: {
                        "agy.security.warning": {
                          message: "This command can access your files.",
                        },
                      },
                    },
                    { optionId: "deny", name: "Deny", kind: "reject_once" },
                  ],
          },
        });
      } else {
        finish();
      }
    } else if (method === "session/cancel") {
      send({ id: promptId, result: { stopReason: "cancelled" } });
    } else {
      send({
        id,
        error: {
          code: -32_601,
          message: `Unsupported fixture method ${method}`,
        },
      });
    }
  }
})();
