import { createServerFn } from "@tanstack/react-start";
import { NPM_LATEST_TIMEOUT_MS } from "#/strategy-constants";
import openMeldCliPackageJson from "../../../../../clients/openmeld-cli/package.json";

const OPENMELD_PACKAGE_NAME = "openmeld";
const NPM_LATEST_URL = `https://registry.npmjs.org/${OPENMELD_PACKAGE_NAME}/latest`;

export type OpenMeldCliLatestRelease = {
	version: string;
};

export function readBundledOpenMeldCliRelease(): OpenMeldCliLatestRelease {
	return {
		version: parseReleaseVersion(
			openMeldCliPackageJson.version,
			"bundled OpenMeld CLI package"
		),
	};
}

export const readOpenMeldCliLatestRelease = createServerFn({
	method: "GET",
}).handler(readOpenMeldCliLatestReleaseFromRegistry);

async function readOpenMeldCliLatestReleaseFromRegistry(): Promise<OpenMeldCliLatestRelease> {
	const response = await fetch(NPM_LATEST_URL, {
		method: "GET",
		signal: AbortSignal.timeout(NPM_LATEST_TIMEOUT_MS),
	});
	const raw = await response.text();
	if (!response.ok) {
		throw new Error(
			`OpenMeld CLI release check failed: HTTP ${response.status}.`
		);
	}

	const parsed = parseNpmLatestResponse(raw);
	return {
		version: parsed.version,
	};
}

function parseNpmLatestResponse(raw: string): OpenMeldCliLatestRelease {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`OpenMeld CLI release check failed: invalid registry response: ${formatErrorMessage(error)}`
		);
	}

	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("version" in parsed) ||
		typeof parsed.version !== "string" ||
		parsed.version.trim().length === 0
	) {
		throw new Error("OpenMeld CLI release check failed: missing version.");
	}

	return {
		version: parseReleaseVersion(parsed.version, "npm registry response"),
	};
}

function parseReleaseVersion(value: unknown, source: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(
			`OpenMeld CLI release check failed: missing version in ${source}.`
		);
	}
	return value.trim();
}

function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
