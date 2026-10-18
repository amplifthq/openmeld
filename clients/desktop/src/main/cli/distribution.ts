/** The public CLI distribution stays on the root domain after the App move. */
export function cliDistributionOrigin(webOrigin: string, preset?: string) {
  const origin = new URL(webOrigin).origin;
  if (
    preset === "prod" &&
    (origin === "https://app.openmeld.ai" || origin === "https://openmeld.ai")
  ) {
    return "https://openmeld.ai";
  }
  return origin;
}
