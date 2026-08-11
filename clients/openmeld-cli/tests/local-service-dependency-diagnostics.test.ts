import { describe, expect, it, vi } from "vitest";
import {
  buildDaemonServiceDependencyDetails,
  buildDaemonServiceDependencyNextStep,
  buildDaemonServiceDependencySummary,
  buildDaemonServiceDependencyTitle,
  type DaemonServiceDependencyDiagnostics,
  resolveDaemonServiceDependencyDiagnostics,
} from "../src/local-service/lifecycle/daemon-service-dependency-diagnostics";

describe("local service dependency diagnostics", () => {
  it("skips remote targets when loopback-only policy is used", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const diagnostics = await resolveDaemonServiceDependencyDiagnostics({
      fetchImpl,
      gatewayUrl: "https://gateway.openmeld.invalid",
      authUrl: "https://auth.openmeld.invalid",
      pathInput: {
        env: {
          OPENMELD_ENV_PRESET: "prod",
        },
      },
      scopePolicy: "loopback_only",
    });

    expect(diagnostics).toEqual({
      applicable: false,
      ready: true,
      lane: "prod",
      scopePolicy: "loopback_only",
      issues: [],
      checkedUrls: {
        auth: "https://auth.openmeld.invalid",
        gateway: "https://gateway.openmeld.invalid",
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports unavailable loopback auth and gateway dependencies", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("down"));

    const diagnostics = await resolveDaemonServiceDependencyDiagnostics({
      authUrl: "http://localhost:8788",
      fetchImpl,
      gatewayUrl: "http://localhost:8080",
      pathInput: {
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
        },
      },
      scopePolicy: "loopback_only",
    });

    expect(diagnostics).toEqual({
      applicable: true,
      ready: false,
      lane: "dev-local",
      scopePolicy: "loopback_only",
      issues: [
        {
          kind: "auth",
          baseUrl: "http://localhost:8788",
          probeUrl: "http://localhost:8788/health",
          scope: "loopback",
          status: "unreachable",
          httpStatus: null,
        },
        {
          kind: "gateway",
          baseUrl: "http://localhost:8080",
          probeUrl: "http://localhost:8080/health",
          scope: "loopback",
          status: "unreachable",
          httpStatus: null,
        },
      ],
      checkedUrls: {
        auth: "http://localhost:8788",
        gateway: "http://localhost:8080",
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:8788/health");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("http://localhost:8080/health");
  });

  it("reports unhealthy remote dependencies under all-target policy", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad gateway", { status: 503 }));

    const diagnostics = await resolveDaemonServiceDependencyDiagnostics({
      authUrl: "https://auth.openmeld.invalid",
      fetchImpl,
      gatewayUrl: "https://gateway.openmeld.invalid",
      pathInput: {
        env: {
          OPENMELD_ENV_PRESET: "canary",
        },
      },
      scopePolicy: "all",
    });

    expect(diagnostics).toEqual({
      applicable: true,
      ready: false,
      lane: "canary",
      scopePolicy: "all",
      issues: [
        {
          kind: "auth",
          baseUrl: "https://auth.openmeld.invalid",
          probeUrl: "https://auth.openmeld.invalid/health",
          scope: "remote",
          status: "unhealthy_http",
          httpStatus: 503,
        },
        {
          kind: "gateway",
          baseUrl: "https://gateway.openmeld.invalid",
          probeUrl: "https://gateway.openmeld.invalid/health",
          scope: "remote",
          status: "unhealthy_http",
          httpStatus: 503,
        },
      ],
      checkedUrls: {
        auth: "https://auth.openmeld.invalid",
        gateway: "https://gateway.openmeld.invalid",
      },
    });
  });

  it("treats an invalid gateway url as unchecked instead of throwing", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("down"));

    const diagnostics = await resolveDaemonServiceDependencyDiagnostics({
      authUrl: "http://localhost:8788",
      fetchImpl,
      gatewayUrl: "not a url",
      pathInput: {
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
        },
      },
      scopePolicy: "loopback_only",
    });

    expect(diagnostics.checkedUrls).toEqual({
      auth: "http://localhost:8788",
      gateway: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://localhost:8788/health");
  });

  it("formats lane-aware summary, details, and retry guidance", () => {
    const diagnostics: Extract<
      DaemonServiceDependencyDiagnostics,
      {
        applicable: true;
        ready: false;
      }
    > = {
      applicable: true,
      ready: false,
      lane: "dev-local",
      scopePolicy: "loopback_only",
      issues: [
        {
          kind: "gateway",
          baseUrl: "http://localhost:8080",
          probeUrl: "http://localhost:8080/health",
          scope: "loopback",
          status: "unreachable",
          httpStatus: null,
        },
      ],
      checkedUrls: {
        auth: "http://localhost:8788",
        gateway: "http://localhost:8080",
      },
    };

    expect(
      buildDaemonServiceDependencyTitle({
        issues: diagnostics.issues,
        lane: diagnostics.lane,
      })
    ).toBe("OpenMeld Dev-Local Dependencies Unavailable");
    expect(
      buildDaemonServiceDependencySummary({
        issues: diagnostics.issues,
        lane: diagnostics.lane,
      })
    ).toContain("OpenMeld dev-local gateway is unavailable");
    expect(
      buildDaemonServiceDependencyDetails({
        issues: diagnostics.issues,
      })
    ).toContain("Gateway URL");
    expect(
      buildDaemonServiceDependencyNextStep({
        command: "start",
        issues: diagnostics.issues,
        lane: diagnostics.lane,
      })
    ).toContain("pnpm dev");
    expect(
      buildDaemonServiceDependencyNextStep({
        command: "start",
        issues: diagnostics.issues,
        lane: diagnostics.lane,
      })
    ).toContain("openmeld service start");
    expect(
      buildDaemonServiceDependencyNextStep({
        command: "status",
        issues: [
          {
            kind: "auth",
            baseUrl: "https://auth.openmeld.invalid",
            probeUrl: "https://auth.openmeld.invalid/health",
            scope: "remote",
            status: "unhealthy_http",
            httpStatus: 503,
          },
        ],
        lane: "prod",
      })
    ).toContain("openmeld service start --mode foreground");
  });
});
