import packageJson from "../../../package.json";

export function resolveCurrentDaemonExpectedVersion(): string {
  return packageJson.version;
}
