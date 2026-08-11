import { describe, expect, it } from "vitest";
import { resolveLocalComponentsSetupAction } from "../src/local-components/manifest";

describe("local components manifest", () => {
  it("prioritizes service and skills updates before connection actions", () => {
    expect(
      resolveLocalComponentsSetupAction({
        cliStatus: "ok",
        serviceKind: "missing",
        serviceStatus: "update_required",
        skillsStatus: "update_required",
      })
    ).toBe("update_service");

    expect(
      resolveLocalComponentsSetupAction({
        cliStatus: "ok",
        serviceKind: "ok",
        serviceStatus: "ok",
        skillsStatus: "update_required",
      })
    ).toBe("update_skills");
  });

  it("maps missing and disconnected service to connect and reconnect", () => {
    expect(
      resolveLocalComponentsSetupAction({
        cliStatus: "ok",
        serviceKind: "missing",
        serviceStatus: "ok",
        skillsStatus: "ok",
      })
    ).toBe("connect_service");

    expect(
      resolveLocalComponentsSetupAction({
        cliStatus: "ok",
        serviceKind: "not_running",
        serviceStatus: "ok",
        skillsStatus: "ok",
      })
    ).toBe("reconnect_service");
  });
});
