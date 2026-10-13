import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "electron";
import { z } from "zod/v4";

const LOGIN_ARGUMENT = "--openmeld-login";
const preferencesSchema = z.strictObject({ startInBackground: z.boolean() });

/** Desktop launch preferences never control the independent OpenMeld Service. */
export function createStartupSettings(
  app: Pick<App, "getLoginItemSettings" | "setLoginItemSettings" | "getPath">,
  platform = process.platform,
  argv = process.argv
) {
  const directory = app.getPath("userData");
  const path = join(directory, "startup-settings.json");

  function getStartInBackground(): boolean {
    try {
      return preferencesSchema.parse(JSON.parse(readFileSync(path, "utf8")))
        .startInBackground;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  function getOpenAtLogin(): boolean {
    const settings = app.getLoginItemSettings();
    // Windows can disable the Run entry in Task Manager without removing it.
    return platform === "win32"
      ? settings.executableWillLaunchAtLogin
      : settings.openAtLogin;
  }

  return {
    getOpenAtLogin,
    getStartInBackground,
    setOpenAtLogin(enabled: boolean) {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        ...(platform === "win32" ? { args: [LOGIN_ARGUMENT], enabled } : {}),
      });
      if (getOpenAtLogin() !== enabled) {
        throw new Error(
          "The system did not apply this change. Check your computer's login items, then try again."
        );
      }
    },
    setStartInBackground(enabled: boolean) {
      if (platform === "win32" && getOpenAtLogin()) {
        // Existing installations registered without a login argument.
        app.setLoginItemSettings({ openAtLogin: true, args: [LOGIN_ARGUMENT] });
      }
      mkdirSync(directory, { recursive: true });
      const temporaryPath = `${path}.tmp`;
      writeFileSync(
        temporaryPath,
        JSON.stringify({ startInBackground: enabled }),
        { mode: 0o600 }
      );
      renameSync(temporaryPath, path);
    },
    shouldStartInBackground(): boolean {
      const openedAtLogin =
        platform === "darwin"
          ? app.getLoginItemSettings().wasOpenedAtLogin
          : platform === "win32" && argv.includes(LOGIN_ARGUMENT);
      return openedAtLogin && getStartInBackground();
    },
  };
}
