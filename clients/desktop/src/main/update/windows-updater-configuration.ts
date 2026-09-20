import {
  desktopPlatformUpdateFeedUrl,
  desktopWindowsBuildSchema,
  resolveDesktopReleasePlatform,
} from "@openmeld/schemas";
import { z } from "zod/v4";

const updaterConfigSchema = z.object({
  provider: z.literal("generic"),
  url: z.string().url(),
  publisherName: z.union([
    z.string().min(1),
    z.array(z.string().min(1)).length(1),
  ]),
});

/** Shared by native startup and signed-artifact inspection; never inferred from a download. */
export function assertWindowsUpdaterConfiguration(input: {
  configuration: unknown;
  windows: unknown;
  arch: string;
}) {
  const windows = desktopWindowsBuildSchema.parse(input.windows);
  const platform = resolveDesktopReleasePlatform("win32", input.arch);
  const config = updaterConfigSchema.parse(input.configuration);
  const names =
    typeof config.publisherName === "string"
      ? [config.publisherName]
      : config.publisherName;
  if (
    platform !== windows.platform ||
    config.url !== desktopPlatformUpdateFeedUrl(windows.platform) ||
    names[0] !== windows.publisherName
  ) {
    throw new Error(
      "Windows Desktop update signing identity or platform does not match this installation."
    );
  }
  return windows;
}
