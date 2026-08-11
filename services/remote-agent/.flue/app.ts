import { waitUntil } from "cloudflare:workers";
import { observe } from "@flue/runtime";
import { Hono } from "hono";
import { installRemoteAgentExecutionInstrumentation } from "../flue-adapter/execution-context";
import { createCenterAgentObservationDispatcher } from "../flue-adapter/observation-dispatcher";
import { handleCenterAgentObservation } from "../flue-adapter/stream-observer";
import { remoteAgentStreamPublisher } from "../flue-adapter/stream-publisher-instance";

const app = new Hono<{ Bindings: CloudflareBindings }>();

installRemoteAgentExecutionInstrumentation();
const dispatchCenterAgentObservation = createCenterAgentObservationDispatcher({
  handle: async (event) =>
    await handleCenterAgentObservation({
      event,
      streamPublisher: remoteAgentStreamPublisher,
    }),
  scheduleBackground: waitUntil,
});
observe((event) => dispatchCenterAgentObservation(event));

app.get("/internal/remote-agent/health", (c) =>
  c.json({ ok: true, worker: "openmeld-remote-agent", harness: "flue" })
);

// Development-lane smoke surface for the Center Agent's computer. This
// worker has no public route in production (internal service binding
// only); the guard keeps the surface out of the prod environment anyway.
app.post("/internal/remote-agent/computer-smoke", async (c) => {
  if (c.env.OPENMELD_WORKER_ENVIRONMENT === "prod") {
    return new Response("Not found", { status: 404 });
  }
  const { runAgentComputerSmoke } = await import(
    "../flue-adapter/computer-smoke"
  );
  const body = (await c.req.json().catch(() => ({}))) as {
    agentProfileId?: string;
    includeContainer?: boolean;
  };
  return c.json(
    await runAgentComputerSmoke({
      agentProfileId: body.agentProfileId ?? "smoke-profile",
      env: c.env as unknown as { AGENT_COMPUTER?: unknown },
      includeContainer: body.includeContainer === true,
    })
  );
});

app.all("*", () => new Response("Not found", { status: 404 }));

export default app;
