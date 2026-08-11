export function shouldForceSetupServiceRefresh(): boolean {
  return process.env.OPENMELD_SETUP_FORCE_SERVICE_REFRESH === "1";
}
