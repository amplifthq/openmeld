import { describe, expect, it } from "vitest";
import { applyOpenMeldDevEnvironment } from "../src/config/openmeld-dev-environment";

describe("openmeld-dev environment", () => {
  it("overrides inherited production lane selectors", () => {
    const env = {
      OPENMELD_AUTH_CLIENT_ID: "openmeld-cli",
      OPENMELD_AUTH_URL: "https://auth.openmeld.ai",
      OPENMELD_ENV_PRESET: "prod",
      OPENMELD_ENV: "prod",
      OPENMELD_GATEWAY_URL: "https://gateway.openmeld.ai",
      OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
      OPENMELD_DEV_MODE: "0",
    } as NodeJS.ProcessEnv;

    applyOpenMeldDevEnvironment(env);

    expect(env.OPENMELD_AUTH_CLIENT_ID).toBe("openmeld-cli-dev");
    expect(env.OPENMELD_AUTH_URL).toBe("http://localhost:8788");
    expect(env.OPENMELD_ENV_PRESET).toBe("dev-local");
    expect(env.OPENMELD_ENV).toBe("dev");
    expect(env.OPENMELD_GATEWAY_URL).toBe("http://localhost:8080");
    expect(env.OPENMELD_USER_FACING_CLI_COMMAND).toBe("openmeld-dev");
    expect(env.OPENMELD_DEV_MODE).toBe("1");
  });

  it("preserves explicit local endpoints while filling missing defaults", () => {
    const env = {
      OPENMELD_GATEWAY_URL: "http://lane.localhost:9010",
      OPENMELD_AUTH_URL: "http://lane.localhost:9011",
      OPENMELD_AUTH_CLIENT_ID: "lane-client",
    } as NodeJS.ProcessEnv;

    applyOpenMeldDevEnvironment(env);

    expect(env.OPENMELD_GATEWAY_URL).toBe("http://lane.localhost:9010");
    expect(env.OPENMELD_AUTH_URL).toBe("http://lane.localhost:9011");
    expect(env.OPENMELD_AUTH_CLIENT_ID).toBe("lane-client");
  });
});
