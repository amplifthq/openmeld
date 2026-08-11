import { describe, expect, it, vi } from "vitest";
import {
  classifyGatewayChainFailure,
  DEFAULT_GATEWAY_CHAIN_TIMEOUT_MS,
  resolveGatewayChainReadiness,
  resolveGatewayChainRepairGuidance,
  resolveGatewayChainRetryGuidance,
} from "../src/system/gateway-chain-readiness";

const INVALID_ERROR_MESSAGE_REGEX = /invalid/i;

const authSession = {
  v: 1 as const,
  accessToken: "token-demo",
  tokenType: "Bearer",
  authBaseUrl: "http://localhost:8788",
  clientId: "openmeld-cli-dev",
  createdAt: "2026-03-24T00:00:00.000Z",
};

describe("gateway chain readiness", () => {
  it("skips the chain probe when auth or profile is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const readiness = await resolveGatewayChainReadiness({
      fetchImpl,
      profile: null,
    });

    expect(readiness).toMatchObject({
      applicable: false,
      ready: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports healthy gateway chains", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const readiness = await resolveGatewayChainReadiness({
      authSession,
      baseUrl: "http://localhost:8080",
      fetchImpl,
      profile: {
        openMeldProfileId: "agt-demo",
        profileName: "Demo Bot",
      },
    });

    expect(readiness).toMatchObject({
      applicable: true,
      ready: true,
      summary: "Gateway auth chain is healthy.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses a production-safe default timeout for cold gateway diagnostics", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await resolveGatewayChainReadiness({
      authSession,
      baseUrl: "http://localhost:8080",
      fetchImpl,
      profile: {
        openMeldProfileId: "agt-demo",
        profileName: "Demo Bot",
      },
    });

    expect(DEFAULT_GATEWAY_CHAIN_TIMEOUT_MS).toBe(30_000);
  });

  it("classifies missing local dev sessions distinctly", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "upstream_unreachable",
            message:
              'Cannot access "resolveRequestAuth" as we couldn\'t find a local dev session for the "GatewayAuthRpcEntrypoint" entrypoint of service "openmeld-auth" to proxy to.',
          },
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        }
      )
    );

    const readiness = await resolveGatewayChainReadiness({
      authSession,
      baseUrl: "http://localhost:8080",
      fetchImpl,
      profile: {
        openMeldProfileId: "agt-demo",
        profileName: "Demo Bot",
      },
    });

    expect(readiness).toMatchObject({
      applicable: true,
      ready: false,
      failureKind: "local_dev_session_missing",
      summary:
        "OpenMeld gateway can't reach the local OpenMeld auth worker session.",
    });
  });

  it("classifies missing local worker names as missing local dev sessions", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "upstream_unreachable",
            message: 'Worker "openmeld-auth" not found',
          },
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        }
      )
    );

    const readiness = await resolveGatewayChainReadiness({
      authSession,
      baseUrl: "http://localhost:8080",
      fetchImpl,
      profile: {
        openMeldProfileId: "agt-demo",
        profileName: "Demo Bot",
      },
    });

    expect(readiness).toMatchObject({
      applicable: true,
      ready: false,
      failureKind: "local_dev_session_missing",
      summary:
        "OpenMeld gateway can't reach the local OpenMeld auth worker session.",
    });
  });

  it("returns a structured failure when base URL resolution throws", async () => {
    const readiness = await resolveGatewayChainReadiness({
      authSession,
      baseUrl: "not a valid url",
      profile: {
        openMeldProfileId: "agt-demo",
        profileName: "Demo Bot",
      },
    });

    expect(readiness).toMatchObject({
      applicable: true,
      baseUrl: "not a valid url",
      ready: false,
      failureKind: "gateway_unreachable",
    });
    expect(readiness.errorMessage).toMatch(INVALID_ERROR_MESSAGE_REGEX);
  });

  it("classifies auth failures before generic gateway unreachability", () => {
    expect(
      classifyGatewayChainFailure({
        code: "auth.unauthenticated",
        message: "authentication required",
        status: 401,
      })
    ).toBe("auth_required");
  });

  it("classifies shared dispatch storage gate failures distinctly", () => {
    expect(
      classifyGatewayChainFailure({
        code: "upstream_unreachable",
        message:
          "Core dispatch storage is not ready: Shared OPENMELD_DB migration is missing required index openMeldDaemon_dispatch_ledger_idempotency_key_unique. Apply the shared DB gate before starting Core.",
        status: 503,
      })
    ).toBe("dispatch_storage_not_ready");
  });

  it("builds dev-local repair and retry guidance", () => {
    expect(
      resolveGatewayChainRepairGuidance({
        failureKind: "local_dev_session_missing",
        lane: "dev-local",
      })
    ).toEqual({
      nextSteps: ["pnpm dev:stop", "pnpm dev", "openmeld doctor --repair"],
      summary:
        "Run `pnpm dev:stop`, then `pnpm dev`, then `openmeld doctor --repair`.",
    });
    expect(
      resolveGatewayChainRetryGuidance({
        failureKind: "local_dev_session_missing",
        lane: "dev-local",
      })
    ).toEqual({
      nextSteps: ["pnpm dev:stop", "pnpm dev", "openmeld doctor --repair"],
      summary:
        "Run `pnpm dev:stop`, then `pnpm dev`, then `openmeld doctor --repair`, then retry.",
    });
  });

  it("builds dev-local shared OPENMELD_DB repair guidance for dispatch storage failures", () => {
    expect(
      resolveGatewayChainRepairGuidance({
        failureKind: "dispatch_storage_not_ready",
        lane: "dev-local",
      })
    ).toEqual({
      nextSteps: [
        "pnpm db:migrate:dev",
        "pnpm db:verify:dev",
        "pnpm dev:stop",
        "pnpm dev",
        "openmeld service status",
      ],
      summary:
        "Run `pnpm db:migrate:dev`, then `pnpm db:verify:dev`, then restart the local OpenMeld dev stack with `pnpm dev:stop` and `pnpm dev`, then verify with `openmeld service status`.",
    });
  });

  it("builds production retry guidance for dispatch storage failures", () => {
    expect(
      resolveGatewayChainRepairGuidance({
        failureKind: "dispatch_storage_not_ready",
        lane: "prod",
      })
    ).toEqual({
      nextSteps: [
        "Retry the OpenMeld command shortly.",
        "If this continues, contact OpenMeld support with the latest command output.",
      ],
      summary:
        "OpenMeld cloud execution storage is temporarily unavailable. Retry shortly; if it continues, contact OpenMeld support.",
    });
  });
});
