import type { Plugin } from "vite";
import { z } from "zod/v4";

export function desktopPilotBuildPrerequisites(
	enabled: boolean,
	installedWebOrigin?: string
): Plugin {
	return {
		name: "openmeld-desktop-pilot-prerequisites",
		apply: "build",
		configResolved(config) {
			if (
				installedWebOrigin &&
				config.env.VITE_BETTER_AUTH_URL !== installedWebOrigin
			) {
				throw new Error(
					"Installed Desktop renderer Auth configuration must match its fixed Web target."
				);
			}
			// Use Vite's resolved client env, including mode files and process priority.
			// Ordinary Web permits this value to be absent; Desktop initializes its
			// shared Auth client before hydration and requires the compiled URL.
			if (
				enabled &&
				!z.url().safeParse(config.env.VITE_BETTER_AUTH_URL).success
			) {
				throw new Error(
					"Desktop pilot builds require a valid VITE_BETTER_AUTH_URL. Build matching Web through OPENMELD_DESKTOP_PILOT=1 pnpm dev:web:worktree in the configured lane."
				);
			}
		},
	};
}
