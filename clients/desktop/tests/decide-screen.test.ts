import { describe, expect, it } from "vitest";
import { decideScreen } from "../src/renderer/state/decide-screen";
import type {
  AuthView,
  CliProblem,
  ServiceLifecycle,
  ServiceView,
} from "../src/shared/view-types";

const SIGNED_IN: AuthView = {
  signedIn: true,
  email: "felix@openmeld.invalid",
  problem: null,
};
const UNKNOWN_AUTH: AuthView = { signedIn: null, email: null, problem: null };

function svc(
  lifecycle: ServiceLifecycle,
  problem: CliProblem | null = null
): ServiceView {
  return {
    lifecycle,
    installed: null,
    running: null,
    autoStart: null,
    cliVersion: null,
    runtimeProjection: null,
    problem,
  };
}

const spawnFailed: CliProblem = {
  kind: "spawn_failed",
  code: "desktop.spawn_failed",
  message: "openmeld not found",
  requestId: null,
};

describe("decideScreen", () => {
  it("routes a definitively signed-out account to sign_in", () => {
    expect(
      decideScreen({
        auth: { signedIn: false, email: null, problem: null },
        service: svc("running"),
      })
    ).toBe("sign_in");
  });

  it("treats unknown auth as not-gating (proceeds to service state)", () => {
    expect(decideScreen({ auth: UNKNOWN_AUTH, service: svc("running") })).toBe(
      "connected"
    );
  });

  it("treats a missing CLI as needs_attention, NOT service-down", () => {
    expect(
      decideScreen({ auth: SIGNED_IN, service: svc("unknown", spawnFailed) })
    ).toBe("needs_attention");
  });

  it("maps lifecycle to the right screen", () => {
    expect(
      decideScreen({ auth: SIGNED_IN, service: svc("not_installed") })
    ).toBe("set_up");
    expect(decideScreen({ auth: SIGNED_IN, service: svc("stopped") })).toBe(
      "stopped"
    );
    expect(decideScreen({ auth: SIGNED_IN, service: svc("running") })).toBe(
      "connected"
    );
    expect(decideScreen({ auth: SIGNED_IN, service: svc("unknown") })).toBe(
      "needs_attention"
    );
  });
});
