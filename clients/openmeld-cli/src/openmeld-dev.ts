import { applyOpenMeldDevEnvironment } from "./config/openmeld-dev-environment";

applyOpenMeldDevEnvironment();

import("./openmeld-entry").catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
