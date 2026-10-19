import { afterEach, expect, it, vi } from "vitest";
import { readInstalledDesktopTarget } from "../../../scripts/desktop/installed-target";
import { installedCommandEnvironment } from "../src/main/installed-environment";

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["production", "prod", "openmeld-cli"],
  ["disposable", "dev-local", "openmeld-cli-dev"],
] as const)("keeps %s device authorization aligned with the managed CLI", (kind, preset, clientId) => {
  vi.stubEnv("OPENMELD_AUTH_CLIENT_ID", "inherited-wrong-client");
  vi.stubEnv("OPENMELD_ENV_PRESET", "canary");
  const target = readInstalledDesktopTarget({
    OPENMELD_DESKTOP_TARGET: kind,
    OPENMELD_DESKTOP_TEST_WEB_ORIGIN: "http://127.0.0.1:3000",
  });
  if (!target) {
    throw new Error("Expected installed target");
  }
  expect(
    installedCommandEnvironment(target, "/test/desktop").env
  ).toMatchObject({
    OPENMELD_ENV_PRESET: preset,
    OPENMELD_AUTH_CLIENT_ID: clientId,
  });
});
