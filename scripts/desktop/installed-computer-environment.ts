import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Only the build process selects the shared test lane; the renderer cannot. */
export function readInstalledComputerEnvironment(env: NodeJS.ProcessEnv) {
  if (env.OPENMELD_DESKTOP_TARGET !== "disposable") {
    return null;
  }
  const home = env.OPENMELD_DESKTOP_TEST_COMPUTER_HOME;
  const auth = env.OPENMELD_DESKTOP_TEST_AUTH_ORIGIN;
  const gateway = env.OPENMELD_DESKTOP_TEST_GATEWAY_ORIGIN;
  if (!(home || auth || gateway)) {
    return null;
  }
  if (
    !(home && auth && gateway && isAbsolute(home)) ||
    resolve(home) === resolve(join(homedir(), ".openmeld"))
  ) {
    throw new Error(
      "The installed test Desktop requires an explicit isolated Computer home, Auth origin, and Gateway origin."
    );
  }
  for (const value of [auth, gateway]) {
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.protocol !== "http:" ||
      !(url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost"))
    ) {
      throw new Error(
        "Installed test Computer endpoints must be fixed loopback origins."
      );
    }
  }
  return { home: resolve(home), auth, gateway };
}
