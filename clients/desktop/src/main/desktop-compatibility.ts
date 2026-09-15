import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_COMPATIBILITY_PATH,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  desktopCompatibilitySchema,
} from "@openmeld/schemas";

export async function checkDesktopCompatibility(
  webOrigin: string,
  fetchCloud: typeof fetch = fetch
) {
  const response = await fetchCloud(
    new URL(DESKTOP_COMPATIBILITY_PATH, webOrigin),
    {
      redirect: "manual",
      cache: "no-store",
      headers: {
        origin: DESKTOP_APP_ORIGIN,
        [DESKTOP_CONTRACT_HEADER]: DESKTOP_CONTRACT_VERSION,
      },
    }
  ).catch(() => {
    throw new Error(
      "Could not connect to OpenMeld. Check your connection and try again."
    );
  });
  if (response.status === 409 || response.status === 404) {
    throw new Error(
      "This version of OpenMeld Desktop is not supported by the server. Check for an app update."
    );
  }
  if (!response.ok) {
    throw new Error("OpenMeld is unavailable right now. Try again shortly.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!desktopCompatibilitySchema.safeParse(payload).success) {
    throw new Error(
      "Desktop could not verify server compatibility. Check for an app update or try again later."
    );
  }
}
