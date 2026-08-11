import { describe, expect, it } from "vitest";
import { parseCliJsonResult } from "../src/main/cli/envelope";
import { toAgentsView, toServiceView } from "../src/main/state/view-state";

function status(stdout: string, exitCode = 0) {
  return parseCliJsonResult({ stdout, exitCode });
}

describe("toServiceView", () => {
  // Real `service status --json` shape: result.runtime.status is a string enum
  // ("running" | "stale" | "not_running" | "unknown"), NOT a boolean.
  it("maps runtime.status 'running' to a running lifecycle", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"daemon.status","result":{"installed":true,"runtime":{"status":"running","pid":42}},"runtimeProjection":null}'
      )
    );
    expect(view.lifecycle).toBe("running");
    expect(view.installed).toBe(true);
    expect(view.running).toBe(true);
    expect(view.autoStart).toBeNull();
    expect(view.problem).toBeNull();
  });

  it("maps runtime.status 'not_running' to a stopped lifecycle", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"daemon.status","result":{"installed":true,"runtime":{"status":"not_running"}}}'
      )
    );
    expect(view.lifecycle).toBe("stopped");
    expect(view.running).toBe(false);
  });

  it("maps runtime.status 'stale' to a stopped lifecycle (offer recovery)", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"daemon.status","result":{"installed":true,"runtime":{"status":"stale"}}}'
      )
    );
    expect(view.lifecycle).toBe("stopped");
  });

  it("maps runtime.status 'unknown' to an unknown lifecycle", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"daemon.status","result":{"installed":true,"runtime":{"status":"unknown"}}}'
      )
    );
    expect(view.lifecycle).toBe("unknown");
    expect(view.running).toBeNull();
  });

  it("maps installed:false to not_installed", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"daemon.status","result":{"installed":false,"state":null}}'
      )
    );
    expect(view.lifecycle).toBe("not_installed");
    expect(view.installed).toBe(false);
  });

  it("falls back to unknown when runtime/installed are absent", () => {
    const view = toServiceView(
      status('{"schemaVersion":1,"type":"daemon.status","result":{}}')
    );
    expect(view.lifecycle).toBe("unknown");
    expect(view.installed).toBeNull();
    expect(view.running).toBeNull();
    expect(view.autoStart).toBeNull();
  });

  it("maps local service-manager enabled state to autoStart", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"daemon.status","localResult":{"serviceManagerStatus":{"installed":true,"running":true,"enabled":false}},"result":{"installed":true,"runtime":{"status":"running","autoStart":true}}}'
      )
    );

    expect(view.lifecycle).toBe("running");
    expect(view.autoStart).toBe(false);
  });

  it("does not use runtime.autoStart as a service-manager fallback", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"daemon.status","result":{"installed":true,"runtime":{"status":"running","autoStart":true}}}'
      )
    );

    expect(view.lifecycle).toBe("running");
    expect(view.autoStart).toBeNull();
  });

  it("passes runtimeProjection through untouched", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"daemon.status","result":{"installed":true,"runtime":{"status":"running"}},"runtimeProjection":{"action":"update","version":"1.2.3"}}'
      )
    );
    expect(view.runtimeProjection).toEqual({
      action: "update",
      version: "1.2.3",
    });
  });

  it("maps service attention from status", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"daemon.status","result":{"installed":true,"runtime":{"status":"running"}},"attention":{"code":"service_update_available","level":"info","message":"Update available","nextStep":"Update OpenMeld Service","anomalyCodes":["bundle_content_drift"]}}'
      )
    );
    expect(view.attention).toEqual({
      code: "service_update_available",
      level: "info",
      message: "Update available",
      nextStep: "Update OpenMeld Service",
      anomalyCodes: ["bundle_content_drift"],
    });
  });

  it("maps CLI version projection from service status", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"daemon.status","cliVersion":{"currentVersion":"1.2.3","latestVersion":"1.2.4","requiredVersion":null,"updateAvailable":true,"checked":true},"result":{"installed":true,"runtime":{"status":"running"}}}'
      )
    );
    expect(view.cliVersion).toEqual({
      checked: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      requiredVersion: null,
      updateAvailable: true,
    });
  });

  it("maps a spawn failure to unknown + a problem", () => {
    const view = toServiceView(
      parseCliJsonResult({
        stdout: "",
        exitCode: 1,
        spawnError: "failed to launch openmeld",
      })
    );
    expect(view.lifecycle).toBe("unknown");
    expect(view.problem?.kind).toBe("spawn_failed");
    expect(view.installed).toBeNull();
    expect(view.autoStart).toBeNull();
  });

  it("surfaces a cli_error code in the problem", () => {
    const view = toServiceView(
      status(
        '{"schemaVersion":1,"type":"error","error":{"code":"service.update_required","message":"update first"}}',
        1
      )
    );
    expect(view.problem?.kind).toBe("cli_error");
    expect(view.problem?.code).toBe("service.update_required");
    expect(view.problem?.message).toBe("update first");
  });
});

describe("toAgentsView", () => {
  const detectStdout =
    '{"schemaVersion":1,"type":"agents.detect","detectedAgents":[{"id":"codex","displayName":"Codex","selectable":true,"blockerReasonCodes":[],"launchStatus":"ready"},{"id":"claude-code","displayName":"Claude Code","selectable":false,"blockerReasonCodes":["not_installed"],"launchStatus":"blocked"}],"count":2}';

  it("maps detect alone with enabled unknown", () => {
    const view = toAgentsView(status(detectStdout));
    expect(view.agents).toHaveLength(2);
    const codex = view.agents[0];
    expect(codex?.id).toBe("codex");
    expect(codex?.detected).toBe(true);
    expect(codex?.lifecycleStatus).toBe("active");
    expect(codex?.selectable).toBe(true);
    expect(codex?.enabled).toBeNull();
    const claude = view.agents[1];
    expect(claude?.selectable).toBe(false);
    expect(claude?.blockerReasonCodes).toEqual(["not_installed"]);
    expect(view.problem).toBeNull();
  });

  it("overlays enabled from list onto detected agents", () => {
    const list = status(
      '{"schemaVersion":1,"type":"agents.list","registrations":[{"agentId":"codex","displayName":"Codex","enabled":true}],"count":1}'
    );
    const view = toAgentsView(status(detectStdout), list);
    expect(view.agents.find((a) => a.id === "codex")?.enabled).toBe(true);
    // Not in list → enabled stays null, not false.
    expect(view.agents.find((a) => a.id === "claude-code")?.enabled).toBeNull();
  });

  it("maps suspended lifecycle status from detect and list output", () => {
    const detect = status(
      '{"schemaVersion":1,"type":"agents.detect","detectedAgents":[{"id":"openclaw","displayName":"OpenClaw","lifecycleStatus":"suspended","selectable":true,"blockerReasonCodes":[],"launchStatus":"ready"}],"count":1}'
    );
    const list = status(
      '{"schemaVersion":1,"type":"agents.list","registrations":[{"agentId":"openclaw","displayName":"OpenClaw","enabled":true,"lifecycleStatus":"suspended"}],"count":1}'
    );

    const view = toAgentsView(detect, list);

    expect(view.agents).toHaveLength(1);
    expect(view.agents[0]).toMatchObject({
      id: "openclaw",
      enabled: true,
      lifecycleStatus: "suspended",
      selectable: true,
    });
  });

  it("merges valid show snapshots onto matching agents", () => {
    const list = status(
      '{"schemaVersion":1,"type":"agents.list","registrations":[{"agentId":"codex","displayName":"Codex","enabled":true}],"count":1}'
    );
    const show = status(
      JSON.stringify({
        schemaVersion: 1,
        type: "agents.show",
        agent: { agentId: "codex", displayName: "Codex" },
        agentControllerInterface: {
          agentControllerRef: "builtin:codex",
          auth: {
            email: "felix@example.com",
            label: "OpenAI",
            status: "authenticated",
            type: "chatgpt",
          },
          capabilities: {
            approvals: true,
            cancel: true,
            interrupt: false,
            modelSelection: true,
            nativeEventStream: true,
            permissionModes: true,
            structuredUserInput: false,
          },
          checkedAt: "2026-06-28T12:00:00.000Z",
          controllerId: "codex",
          displayName: "Codex",
          launch: {
            argsPrefix: [],
            commandPath: "/opt/homebrew/bin/codex",
            installChoiceCount: 1,
            status: "ready",
          },
          message: null,
          models: [{ displayName: "GPT-5.5", id: "gpt-5.5" }],
          nativeInterface: "codex-app-server",
          schemaVersion: 1,
          skills: [],
          status: "ready",
          version: "0.38.0",
        },
      })
    );

    const view = toAgentsView(status(detectStdout), list, [show]);

    expect(
      view.agents.find((a) => a.id === "codex")?.agentControllerInterface
    ).toMatchObject({
      agentControllerRef: "builtin:codex",
      nativeInterface: "codex-app-server",
      models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
    });
  });

  it("ignores malformed show snapshots instead of rendering unknown controller facts", () => {
    const list = status(
      '{"schemaVersion":1,"type":"agents.list","registrations":[{"agentId":"codex","displayName":"Codex","enabled":true}],"count":1}'
    );
    const malformedShow = status(
      '{"schemaVersion":1,"type":"agents.show","agent":{"agentId":"codex"},"agentControllerInterface":{"agentControllerRef":"builtin:codex"}}'
    );

    const view = toAgentsView(status(detectStdout), list, [malformedShow]);

    expect(
      view.agents.find((a) => a.id === "codex")?.agentControllerInterface
    ).toBeNull();
  });

  it("appends registered-but-undetected agents from list", () => {
    const list = status(
      '{"schemaVersion":1,"type":"agents.list","registrations":[{"agentId":"ghost","displayName":"Ghost","enabled":false}],"count":1}'
    );
    const view = toAgentsView(status(detectStdout), list);
    const ghost = view.agents.find((a) => a.id === "ghost");
    expect(ghost?.detected).toBe(false);
    expect(ghost?.enabled).toBe(false);
    expect(ghost?.lifecycleStatus).toBe("active");
    expect(ghost?.selectable).toBe(false);
  });

  it("surfaces a detect failure as the problem (detect takes priority)", () => {
    const detectFail = parseCliJsonResult({
      stdout: "",
      exitCode: 1,
      spawnError: "no openmeld",
    });
    const list = status(
      '{"schemaVersion":1,"type":"agents.list","registrations":[{"agentId":"codex","enabled":true}],"count":1}'
    );
    const view = toAgentsView(detectFail, list);
    expect(view.problem?.kind).toBe("spawn_failed");
    // List still contributes its agents.
    expect(view.agents.find((a) => a.id === "codex")?.enabled).toBe(true);
  });

  it("skips malformed entries without throwing", () => {
    const view = toAgentsView(
      status(
        '{"schemaVersion":1,"type":"agents.detect","detectedAgents":["nope",{"displayName":"no id"},{"id":"ok","selectable":true}],"count":1}'
      )
    );
    expect(view.agents).toHaveLength(1);
    expect(view.agents[0]?.id).toBe("ok");
    // Missing displayName falls back to the id.
    expect(view.agents[0]?.displayName).toBe("ok");
  });
});
