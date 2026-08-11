import { githubAppInstallationSetupQuerySchema } from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { OpenConnectorClient } from "../lib/openconnector-client";

export function registerGitHubAppRoutes(app: Hono<HonoBindings>): void {
  app.get("/github/app/setup", handleGitHubAppSetup);
}

async function handleGitHubAppSetup(
  c: Context<HonoBindings>
): Promise<Response> {
  const query = githubAppInstallationSetupQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return installationErrorPage(
      "OpenMeld could not verify this GitHub App installation request.",
      400
    );
  }

  let verification: Awaited<
    ReturnType<typeof c.var.coreRpc.beginGitHubAppInstallationVerification>
  >;
  try {
    verification = await c.var.coreRpc.beginGitHubAppInstallationVerification({
      installationId: query.data.installation_id,
      state: query.data.state,
    });
  } catch (error) {
    console.warn("[gateway.github_app.state_validation_failed]", {
      error: toSafeErrorMessage(error),
      requestId: c.var.ingressOpenMeldContext.requestId,
    });
    return installationErrorPage(
      "OpenMeld could not verify this GitHub App installation request.",
      502
    );
  }
  if (verification.status === "invalid") {
    return installationErrorPage(
      "This GitHub App installation link is invalid or has already been used.",
      400
    );
  }
  if (verification.status === "expired") {
    return installationErrorPage(
      "This GitHub App installation link expired. Close this window and start again from OpenMeld.",
      410
    );
  }

  try {
    const authorization = await createOpenConnectorClient(
      c.env
    ).startAuthorization({
      connectionName: verification.verificationConnectionName,
      service: "github",
    });
    return c.redirect(authorization.authorizationUrl, 302);
  } catch (error) {
    console.warn("[gateway.github_app.verification_oauth_failed]", {
      error: toSafeErrorMessage(error),
      installationId: verification.installationId,
      organizationId: verification.organizationId,
      requestId: c.var.ingressOpenMeldContext.requestId,
    });
    return installationErrorPage(
      "GitHub was installed, but OpenMeld could not verify the installer. Close this window and try again.",
      502
    );
  }
}

function createOpenConnectorClient(
  env: HonoBindings["Bindings"]
): OpenConnectorClient {
  return new OpenConnectorClient({
    adminToken: env.OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN ?? "",
    baseUrl: env.OPENMELD_CONNECTORS_BASE_URL ?? "",
  });
}

function installationErrorPage(message: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitHub setup</title></head><body><main><h1>GitHub setup could not finish</h1><p>${escapeHtml(message)}</p></main></body></html>`,
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      },
      status,
    }
  );
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function toSafeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
}
