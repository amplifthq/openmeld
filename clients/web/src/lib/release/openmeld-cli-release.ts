import { readCliRelease } from "@openmeld/api-client";
import { type CliRelease, cliReleaseSchema } from "@openmeld/schemas";
import { createIsomorphicFn } from "@tanstack/react-start";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import openMeldCliPackageJson from "../../../../../clients/openmeld-cli/package.json";

export type OpenMeldCliLatestRelease = CliRelease;
export function readBundledOpenMeldCliRelease(): OpenMeldCliLatestRelease {
	return cliReleaseSchema.parse({ version: openMeldCliPackageJson.version });
}
export const readOpenMeldCliLatestRelease = createIsomorphicFn()
	.client(() => readCliRelease(createUnscopedWebOpenMeldApiFoundation()))
	.server(async () => {
		const { getCliReleaseResponse } = await import("./cli-release.server");
		const response = await getCliReleaseResponse();
		if (!response.ok) {
			throw new Error(
				`OpenMeld CLI release check failed: HTTP ${response.status}.`
			);
		}
		return cliReleaseSchema.parse(await response.json());
	});
