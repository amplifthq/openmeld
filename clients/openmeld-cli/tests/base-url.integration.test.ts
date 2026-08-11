import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GATEWAY_BASE_URL,
  DEV_LOCAL_GATEWAY_BASE_URL,
  normalizeGatewayBaseUrl,
  resolveBaseUrl,
  resolveBaseUrlOrNull,
  resolveExplicitGatewayUrlOrThrow,
} from "../src/config/base-url";
import { setConfiguredBaseUrl } from "../src/config/runtime-config";
import { withTempHome } from "./helpers/fs";

describe("resolveBaseUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses cli value when provided", async () => {
    expect(await resolveBaseUrl("http://127.0.0.1:9999/")).toBe(
      "http://127.0.0.1:9999"
    );
  });

  it("uses OPENMELD_GATEWAY_URL when cli value is missing", async () => {
    vi.stubEnv("OPENMELD_GATEWAY_URL", "https://gateway.example.workers.dev/");
    expect(await resolveBaseUrl(undefined)).toBe(
      "https://gateway.example.workers.dev"
    );
  });

  it("uses the dev-local gateway default when no override is configured", async () => {
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");
      vi.stubEnv("OPENMELD_GATEWAY_URL", "");
      expect(await resolveBaseUrl(undefined)).toBe(DEV_LOCAL_GATEWAY_BASE_URL);
    });
  });

  it("uses the local gateway default for the packaged canary lane", async () => {
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_ENV_PRESET", "canary");
      vi.stubEnv("OPENMELD_GATEWAY_URL", "");
      expect(await resolveBaseUrl(undefined)).toBe(DEV_LOCAL_GATEWAY_BASE_URL);
    });
  });

  it("uses the injected canary env when resolving the default gateway", async () => {
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_ENV_PRESET", "prod");
      vi.stubEnv("OPENMELD_GATEWAY_URL", "");
      expect(
        await resolveBaseUrl(undefined, {
          env: {
            ...process.env,
            OPENMELD_ENV_PRESET: "canary",
            OPENMELD_GATEWAY_URL: "",
          },
        })
      ).toBe(DEV_LOCAL_GATEWAY_BASE_URL);
    });
  });

  it("falls back to the release gateway default and then local config when env is empty", async () => {
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_ENV_PRESET", "prod");
      vi.stubEnv("OPENMELD_GATEWAY_URL", "");
      expect(await resolveBaseUrl(undefined)).toBe(DEFAULT_GATEWAY_BASE_URL);
      await setConfiguredBaseUrl("http://127.0.0.1:8080/");
      expect(await resolveBaseUrl(undefined)).toBe("http://127.0.0.1:8080");
    });
  });

  it("rejects auth worker origins when resolving a gateway URL", () => {
    expect(() => normalizeGatewayBaseUrl("http://localhost:8788")).toThrow(
      "gateway URL must point to the OpenMeld gateway, not the OpenMeld auth worker"
    );
    expect(() =>
      normalizeGatewayBaseUrl("https://auth.openmeld.invalid")
    ).toThrow(
      "gateway URL must point to the OpenMeld gateway, not the OpenMeld auth worker"
    );
    expect(() =>
      normalizeGatewayBaseUrl("https://auth-preview.openmeld.test")
    ).toThrow(
      "gateway URL must point to the OpenMeld gateway, not the OpenMeld auth worker"
    );
  });

  it("rejects non-origin gateway URL values", async () => {
    await expect(
      resolveBaseUrl("https://gateway.example.workers.dev/api")
    ).rejects.toThrow("baseUrl must be origin-only");
  });

  it("rejects auth worker URLs from local runtime config writes", async () => {
    await withTempHome(async () => {
      await expect(
        setConfiguredBaseUrl("http://localhost:8788/")
      ).rejects.toThrow(
        "gateway URL must point to the OpenMeld gateway, not the OpenMeld auth worker"
      );
    });
  });

  it("returns null for invalid optional gateway URL resolution", async () => {
    await expect(
      resolveBaseUrlOrNull("https://gateway.example.workers.dev/api")
    ).resolves.toBeNull();
  });

  it("returns null for auth worker URLs in optional gateway resolution", async () => {
    await expect(resolveBaseUrlOrNull("http://localhost:8788")).resolves.toBe(
      null
    );
  });

  it("rejects invalid explicit gateway URLs with stable command copy", async () => {
    await expect(
      resolveExplicitGatewayUrlOrThrow(
        "https://gateway.example.workers.dev/api"
      )
    ).rejects.toThrow(
      'Invalid explicit gateway URL "https://gateway.example.workers.dev/api": baseUrl must be origin-only'
    );
  });

  it("rejects explicit auth worker URLs with stable command copy", async () => {
    await expect(
      resolveExplicitGatewayUrlOrThrow("http://localhost:8788")
    ).rejects.toThrow(
      'Invalid explicit gateway URL "http://localhost:8788": gateway URL must point to the OpenMeld gateway, not the OpenMeld auth worker'
    );
  });
});
