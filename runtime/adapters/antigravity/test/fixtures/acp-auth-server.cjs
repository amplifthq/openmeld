"use strict";
// Initialization and signed-out error captured from Google's ACP 1.3.0.
// Successful authenticate/session responses follow ACP SDK 1.7.0 wire types.
// This models the provider boundary, not a Google OAuth server.
const { existsSync, writeFileSync, appendFileSync } = require("node:fs");
const { createInterface } = require("node:readline");
const { join } = require("node:path");
const profile = process.env.GEMINI_HOME;
const send = (id, fields) =>
  console.log(JSON.stringify({ jsonrpc: "2.0", id, ...fields }));
const url =
  "https://accounts.google.com/o/oauth2/v2/auth?state=fixture&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A19876%2F";
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method } = JSON.parse(line);
  appendFileSync(join(profile, "requests.jsonl"), `${method}\n`);
  if (process.env.AGY_ACP_FORCE_FILE_STORAGE !== "1") {
    process.exit(3);
  }
  if (method === "initialize") {
    send(id, {
      result: {
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [{ id: "oauth-personal", name: "Log in with Google" }],
        agentInfo: { name: "antigravity-acp", version: "1.3.0" },
      },
    });
  } else if (method === "authenticate") {
    const line = `Open the following link to authenticate the ACP server: ${url}\n`;
    process.stderr.write(line.slice(0, 35));
    process.stderr.write(line.slice(35));
    if (process.env.FIXTURE_WAIT === "1") {
      return;
    }
    writeFileSync(join(profile, "signed-in"), "fixture");
    send(id, { result: {} });
  } else if (method === "session/new") {
    if (process.env.FIXTURE_NETWORK === "1") {
      send(id, { error: { code: -32_603, message: "Connection failed" } });
    } else if (existsSync(join(profile, "signed-in"))) {
      send(id, {
        result: {
          sessionId: "verified-session",
          configOptions: [
            {
              id: "model",
              name: "Model",
              type: "select",
              currentValue: "model",
              options: [{ value: "model", name: "Test model" }],
            },
          ],
        },
      });
    } else if (process.env.FIXTURE_EXPIRED === "1") {
      process.stderr.write(
        "I1013 credential_manager.py:561] Credentials missing or invalid. Launching browser login flow...\n"
      );
    } else {
      send(id, {
        error: {
          code: -32_000,
          message: "Authentication required",
          data: {
            message:
              "No authentication method selected. Please call authenticate or configure auth.type in settings.json.",
          },
        },
      });
    }
  } else {
    process.exit(4);
  }
});
