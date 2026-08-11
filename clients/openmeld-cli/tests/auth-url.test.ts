import { describe, expect, it } from "vitest";
import {
  DEV_LOCAL_AUTH_BASE_URL,
  resolveAuthBaseUrl,
} from "../src/config/auth-url";

describe("auth URL resolution", () => {
  it("uses default auth URL when no input provided", () => {
    const prev = process.env.OPENMELD_AUTH_URL;
    try {
      process.env.OPENMELD_AUTH_URL = "";
      expect(resolveAuthBaseUrl(undefined)).toBe("https://auth.openmeld.ai");
    } finally {
      if (prev === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_AUTH_URL");
      } else {
        process.env.OPENMELD_AUTH_URL = prev;
      }
    }
  });

  it("prefers OPENMELD_AUTH_URL env over default", () => {
    const prev = process.env.OPENMELD_AUTH_URL;
    try {
      process.env.OPENMELD_AUTH_URL = "https://auth.openmeld.ai///";
      expect(resolveAuthBaseUrl(undefined)).toBe("https://auth.openmeld.ai");
    } finally {
      if (prev === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_AUTH_URL");
      } else {
        process.env.OPENMELD_AUTH_URL = prev;
      }
    }
  });

  it("uses the local auth default for the dev-local lane", () => {
    expect(
      resolveAuthBaseUrl(undefined, {
        env: {
          OPENMELD_AUTH_URL: "",
          OPENMELD_ENV_PRESET: "dev-local",
        },
      })
    ).toBe(DEV_LOCAL_AUTH_BASE_URL);
  });

  it("uses the local auth default for the packaged canary lane", () => {
    expect(
      resolveAuthBaseUrl(undefined, {
        env: {
          OPENMELD_AUTH_URL: "",
          OPENMELD_ENV_PRESET: "canary",
        },
      })
    ).toBe(DEV_LOCAL_AUTH_BASE_URL);
  });

  it("prefers CLI auth URL over env", () => {
    const prev = process.env.OPENMELD_AUTH_URL;
    try {
      process.env.OPENMELD_AUTH_URL = "https://auth.env.example";
      expect(resolveAuthBaseUrl("https://auth.cli.example////")).toBe(
        "https://auth.cli.example"
      );
    } finally {
      if (prev === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_AUTH_URL");
      } else {
        process.env.OPENMELD_AUTH_URL = prev;
      }
    }
  });
});
