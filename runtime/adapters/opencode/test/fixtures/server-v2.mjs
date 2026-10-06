// HTTP paths and payloads from @opencode/client 2.0.24 generated types.
// Startup, subscription and execution receipts also captured from opencode2 2.0.24.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

if (process.argv[2] !== "serve") {
  throw new Error("Dispatch must not run a version probe");
}
const arg = (name) =>
  process.argv
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? process.argv[process.argv.indexOf(name) + 1];
const scenario = process.env.FIXTURE_SCENARIO;
const sessionID = "ses_native";
const info = {
  id: sessionID,
  location: { directory: process.env.FIXTURE_DIRECTORY ?? process.cwd() },
  permissions: [],
};
let events;
let eventIndex = 0;
const emit = (type, data) =>
  events.write(
    `data: ${JSON.stringify({ id: `evt_${++eventIndex}`, created: Date.now(), type, data })}\n\n`
  );
const finish = () => {
  emit("session.text.delta", {
    sessionID,
    assistantMessageID: "assistant_current",
    ordinal: 0,
    delta: "Native reply",
  });
  emit("session.execution.succeeded", { sessionID });
};
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Explicit native routes keep this protocol fixture independently readable.
const server = createServer(async (request, response) => {
  if (
    request.headers.authorization !==
    `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_PASSWORD}`).toString("base64")}`
  ) {
    response.writeHead(401).end();
    return;
  }
  const path = new URL(request.url, "http://localhost").pathname;
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
  }
  const body = raw ? JSON.parse(raw) : null;
  if (process.env.FIXTURE_LOG) {
    appendFileSync(
      process.env.FIXTURE_LOG,
      `${JSON.stringify({ path, method: request.method, body })}\n`
    );
  }
  const json = (value) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (path === "/api/info") {
    return json({ version: "2.0.24", pid: process.pid });
  }
  if (path === "/api/session/active") {
    return json({
      data: scenario === "busy" ? { [sessionID]: { status: "running" } } : {},
    });
  }
  if (path === "/api/session" || path === `/api/session/${sessionID}`) {
    return json({ data: info });
  }
  if (path === `/api/session/${sessionID}/fork`) {
    return json({ data: { ...info, id: "ses_fork" } });
  }
  if (path === "/api/event") {
    response.writeHead(200, { "content-type": "text/event-stream" });
    events = response;
    emit("server.connected", {});
    return;
  }
  if (path.endsWith("/prompt")) {
    json({
      data: {
        id: "inbox_current",
        sessionID,
        type: "user",
        time: { created: Date.now() },
      },
    });
    emit("session.execution.started", { sessionID });
    emit("session.inbox.delivered", {
      sessionID,
      inboxID: scenario === "wrong-receipt" ? "inbox_other" : "inbox_current",
    });
    if (scenario === "failure") {
      emit("session.execution.failed", {
        sessionID,
        error: { type: "provider.error", message: "Insufficient balance" },
      });
      return;
    }
    if (scenario === "permission" || scenario === "exit-during-question") {
      emit("permission.asked", {
        sessionID,
        id: "permission_1",
        action: "shell",
        resources: ["git status"],
        save: ["git status"],
      });
      if (scenario === "exit-during-question") {
        process.exit(2);
      }
      return;
    }
    if (scenario === "form") {
      emit("form.created", {
        form: {
          id: "form_1",
          sessionID,
          title: "Choose output",
          fields: [
            {
              key: "format",
              type: "string",
              title: "Format",
              required: true,
              options: [
                { label: "Markdown", value: "md" },
                { label: "Plain text", value: "txt" },
              ],
            },
          ],
        },
      });
      return;
    }
    finish();
    return;
  }
  if (path.endsWith("/reply")) {
    response.writeHead(204).end();
    finish();
    return;
  }
  if (path.endsWith("/message")) {
    return json({
      data: [
        {
          type: "assistant",
          id: "assistant_old",
          content: [{ type: "text", text: "Old answer must not leak" }],
        },
        {
          type: "assistant",
          id: "assistant_current",
          content: [{ type: "text", text: "Native reply" }],
        },
      ],
    });
  }
  response.writeHead(204).end();
});
server.listen(Number(arg("--port")), arg("--hostname"), () =>
  console.log(
    `server listening on http://${arg("--hostname")}:${arg("--port")}`
  )
);
process.on("SIGTERM", () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
