import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type AccountDeletionConnection,
  accountDeletionConnectionSchema,
} from "@openmeld/schemas";
import { Hono } from "hono";
import { parseAnonymousSpaceReadRoute } from "./lib/anonymous-space-read-routes";
import type { HonoBindings } from "./lib/bindings";
import { OpenConnectorClient } from "./lib/openconnector-client";
import { gatewayAuthMiddleware } from "./middlewares/auth";
import { gatewayContextMiddleware } from "./middlewares/context";
import { publicReadRateLimitMiddleware } from "./middlewares/public-read-rate-limit";
import { registerDaemonStreamRoute } from "./routes/daemon-stream";
import { registerGitHubAppRoutes } from "./routes/github-app";
import { registerLarkPlatformWebhookRoutes } from "./routes/lark-platform-webhooks";
import { registerLocalRoutineTickRoute } from "./routes/local-routine-tick";
import { registerPrepareSessionStreamRoute } from "./routes/prepare-session-stream";
import { registerRootRoute } from "./routes/root";
import { registerRpcHttpRoutes } from "./routes/rpc-http";
import { registerFeedbackRoutes } from "./routes/rpc-http.feedback";
import { registerSlackEventsRoute } from "./routes/slack-events";
import { registerSlackInteractiveRoute } from "./routes/slack-interactive";
import { registerSlackOAuthRoutes } from "./routes/slack-oauth";
import { registerAccountInvalidationStreamRoute } from "./routes/ws-account-invalidation";
import { registerWebSocketRoute } from "./routes/ws-stream";

const app = new Hono<HonoBindings>();
app.use("/v1/*", gatewayContextMiddleware);
app.use("/v1/*", publicReadRateLimitMiddleware);
app.use("/v1/*", async (c, next) => {
  await next();
  if (parseAnonymousSpaceReadRoute(c.req.raw)) {
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
  }
});
app.use("/v1/*", gatewayAuthMiddleware);
app.use("/slack/oauth/*", gatewayContextMiddleware);
app.use("/slack/oauth/start", gatewayAuthMiddleware);
app.use("/slack/identity/*", gatewayContextMiddleware);
app.use("/slack/identity/start", gatewayAuthMiddleware);
app.use("/github/app/*", gatewayContextMiddleware);

registerRootRoute(app);
registerLocalRoutineTickRoute(app);
registerLarkPlatformWebhookRoutes(app);
registerSlackEventsRoute(app);
registerSlackInteractiveRoute(app);
registerSlackOAuthRoutes(app);
registerGitHubAppRoutes(app);
registerFeedbackRoutes(app);
registerRpcHttpRoutes(app);
registerPrepareSessionStreamRoute(app);
registerWebSocketRoute(app);
registerAccountInvalidationStreamRoute(app);
registerDaemonStreamRoute(app);

export default app;

/** Internal Core lifecycle binding. Connection administration remains in Gateway. */
export class AccountDeletionEntrypoint extends WorkerEntrypoint<CloudflareBindings> {
  async disconnectAccountConnection(
    raw: AccountDeletionConnection
  ): Promise<void> {
    const input = accountDeletionConnectionSchema.parse(raw);
    if (!this.env.OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN) {
      throw new Error("App connection cleanup is unavailable.");
    }
    await new OpenConnectorClient({
      adminToken: this.env.OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN,
      baseUrl: this.env.OPENMELD_CONNECTORS_BASE_URL,
    }).disconnect(input);
  }
}
