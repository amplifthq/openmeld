import { desktopInstalledTargetSchema } from "../../packages/schemas/src/desktop-client.ts";

/** Build-time only. Packaged apps never consult the launch environment. */
export function readInstalledDesktopTarget(env: NodeJS.ProcessEnv) {
  if (!env.OPENMELD_DESKTOP_TARGET) {
    return null;
  }
  if (env.OPENMELD_DESKTOP_TARGET === "production") {
    return desktopInstalledTargetSchema.parse({
      kind: "production",
      webOrigin: "https://openmeld.ai",
      authScheme: "sh.openmeld.desktop",
      clientId: "openmeld-desktop",
      appId: "sh.openmeld.desktop",
      dataDirectory: "OpenMeld Desktop",
    });
  }
  if (env.OPENMELD_DESKTOP_TARGET === "disposable") {
    return desktopInstalledTargetSchema.parse({
      kind: "disposable",
      webOrigin: env.OPENMELD_DESKTOP_TEST_WEB_ORIGIN,
      authScheme: "sh.openmeld.desktop.test",
      clientId: "openmeld-desktop-test",
      appId: "sh.openmeld.desktop.test",
      dataDirectory: "OpenMeld Desktop Test",
    });
  }
  throw new Error("Unknown installed Desktop build target");
}
