import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	WebApplicationErrorQueryDiagnostic,
	WebApplicationErrorReport,
} from "@openmeld/schemas";

const DIAGNOSTIC_REQUEST_ID = /^[A-Za-z0-9_.:-]+$/;

export function readApplicationErrorRequestFailure(
	error: unknown
): WebApplicationErrorQueryDiagnostic["failure"] {
	const failure = toStructuredApiClientFailure(error);
	const requestId = failure.requestId?.trim() ?? "";
	return {
		code: failure.code,
		requestId:
			requestId.length > 0 &&
			requestId.length <= 256 &&
			DIAGNOSTIC_REQUEST_ID.test(requestId)
				? requestId
				: null,
		status:
			typeof failure.status === "number" &&
			Number.isInteger(failure.status) &&
			failure.status >= 100 &&
			failure.status <= 599
				? failure.status
				: null,
	};
}

declare const __OPENMELD_WEB_BUILD__: {
	id: string;
	sha: string;
	dirty: boolean;
};

export const WEB_ERROR_BUILD =
	typeof __OPENMELD_WEB_BUILD__ === "undefined"
		? { id: null, sha: null, dirty: true }
		: __OPENMELD_WEB_BUILD__;

const ERROR_NAMES = new Set([
	"Error",
	"TypeError",
	"ReferenceError",
	"SyntaxError",
	"RangeError",
	"URIError",
]);
const MODULE_ERROR =
	/dynamically imported module|importing a module script failed|module script/;
const PROPERTY_ERROR = /cannot read properties of (undefined|null)/;
const HYDRATION_ERROR =
	/hydration|hydrating|react error #418|react error #423|react error #425/;
const REACT_UPDATE_DEPTH_ERROR =
	/max(?:imum)? update depth exceeded|react error #185/i;
const ASSET_FRAME =
	/(?:assets\/[A-Za-z0-9_$.-]+\.(?:js|css)|\bserver\.js)(?::\d{1,9}:\d{1,9})?/g;

export function summarizeApplicationError(
	error: unknown,
	resource?: string
): WebApplicationErrorReport["error"] {
	// Arbitrary exception text can contain a message, prompt, or credential.
	// Classify it locally; only allowlisted codes and build locations leave here.
	let message = "";
	if (error instanceof Error) {
		message = error.message.slice(0, 16_000);
	} else if (typeof error === "string") {
		message = error.slice(0, 16_000);
	}
	const text = message.toLowerCase();
	let code: WebApplicationErrorReport["error"]["code"] = "unexpected";
	if (MODULE_ERROR.test(text)) {
		code = "module_load_failed";
	} else if (text.includes("unable to preload css")) {
		code = "css_load_failed";
	} else if (PROPERTY_ERROR.test(text)) {
		code = "undefined_property";
	} else if (text.includes("is not a function")) {
		code = "not_callable";
	} else if (HYDRATION_ERROR.test(text)) {
		code = "hydration_failed";
	} else if (REACT_UPDATE_DEPTH_ERROR.test(message)) {
		code = "react_update_depth";
	}
	const locations = [
		error instanceof Error ? (error.stack ?? "").slice(0, 16_000) : "",
		(resource ?? "").slice(0, 2000),
		message,
	]
		.join("\n")
		.slice(0, 16_000);
	const frames = [...new Set(locations.match(ASSET_FRAME) ?? [])]
		.filter((frame) => frame.length <= 240)
		.slice(0, 12);
	return {
		name:
			error instanceof Error && ERROR_NAMES.has(error.name)
				? (error.name as WebApplicationErrorReport["error"]["name"])
				: "Unknown",
		code,
		frames,
	};
}
