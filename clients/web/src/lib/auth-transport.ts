import type { AuthClientError } from "./auth-client-types";
import { readResponseBody } from "./http-response";

export type AuthTransportResult<Data = unknown> = {
	data: Data | null;
	error: AuthClientError | null;
};

type AuthRequestInit = Omit<RequestInit, "credentials">;

type RequestAuthEndpointInput = {
	path: string;
	request: AuthRequestInit;
	fallbackMessage: string;
	redirectErrorHandling?: "enabled" | "none";
};

type RedirectedAuthError = {
	code: string;
	description?: string;
};

type AuthErrorFields = {
	code?: unknown;
	description?: unknown;
	message?: unknown;
	status?: unknown;
	statusText?: unknown;
};

function readOptionalText(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function pickAuthErrorFields(record: Record<string, unknown>): AuthErrorFields {
	return {
		code: record.code,
		description: record.description,
		message: record.message,
		status: record.status,
		statusText: record.statusText,
	};
}

function resolveAuthErrorFields(input: unknown): AuthErrorFields {
	if (typeof input === "string") {
		return { message: input };
	}
	if (!input || typeof input !== "object") {
		return {};
	}

	const record = input as Record<string, unknown>;
	const nestedError = record.error;
	if (typeof nestedError === "string") {
		return {
			...pickAuthErrorFields(record),
			message: nestedError,
		};
	}
	if (nestedError && typeof nestedError === "object") {
		const nestedRecord = nestedError as Record<string, unknown>;
		return {
			code: nestedRecord.code ?? record.code,
			description: nestedRecord.description ?? record.description,
			message:
				nestedRecord.message ??
				nestedRecord.description ??
				nestedRecord.error ??
				record.message,
			status: nestedRecord.status ?? record.status,
			statusText: nestedRecord.statusText ?? record.statusText,
		};
	}

	return pickAuthErrorFields(record);
}

export function toAuthError(
	input: unknown,
	fallbackMessage: string,
	status = 400,
	statusText = "Bad Request"
): AuthClientError {
	const fields = resolveAuthErrorFields(input);
	const code = readOptionalText(fields.code);
	const description = readOptionalText(fields.description);
	return {
		...(code ? { code } : {}),
		...(description ? { description } : {}),
		message: readOptionalText(fields.message) ?? description ?? fallbackMessage,
		status: typeof fields.status === "number" ? fields.status : status,
		statusText: readOptionalText(fields.statusText) ?? statusText,
	};
}

export function normalizeClientResult<Data = unknown>(
	result: unknown,
	fallbackMessage: string
): AuthTransportResult<Data> {
	if (!result || typeof result !== "object") {
		return {
			data: (result ?? null) as Data | null,
			error: null,
		};
	}

	const resultRecord = result as {
		data?: unknown;
		error?: unknown;
	};

	if (!("data" in resultRecord || "error" in resultRecord)) {
		return {
			data: result as Data,
			error: null,
		};
	}

	return {
		data: (resultRecord.data ?? null) as Data | null,
		error: resultRecord.error
			? toAuthError(resultRecord.error, fallbackMessage)
			: null,
	};
}

export async function resolveClientResult<Data = unknown>(
	execute: () => unknown | Promise<unknown>,
	fallbackMessage: string
): Promise<AuthTransportResult<Data>> {
	try {
		return normalizeClientResult<Data>(await execute(), fallbackMessage);
	} catch (error) {
		return {
			data: null,
			error: toAuthError(error, fallbackMessage),
		};
	}
}

export async function parseResponseBody(response: Response) {
	return await readResponseBody(response);
}

export async function requestAuthEndpoint<Data = unknown>(
	input: RequestAuthEndpointInput
): Promise<AuthTransportResult<Data>> {
	try {
		const response = await fetch(
			`/api/auth${input.path}`,
			buildAuthFetchRequestInit(input.request)
		);

		if (!response.ok) {
			const redirectResult = readRedirectErrorResult(response, input);
			if (redirectResult) {
				return redirectResult;
			}

			const payload = await parseResponseBody(response);
			if (!payload.ok) {
				return {
					data: null,
					error: buildInvalidResponseError({
						fallbackMessage: input.fallbackMessage,
						reason: payload.reason,
						response,
					}),
				};
			}

			return {
				data: null,
				error: toAuthError(
					payload.value,
					input.fallbackMessage,
					response.status,
					response.statusText
				),
			};
		}

		if (input.redirectErrorHandling === "enabled") {
			const redirectedError = extractRedirectErrorFromUrl(response.url);
			if (redirectedError) {
				return {
					data: null,
					error: toAuthError(
						buildRedirectAuthErrorPayload(redirectedError),
						input.fallbackMessage,
						400,
						"Bad Request"
					),
				};
			}
			if (response.redirected) {
				return buildSessionNotEstablishedRedirectResult(response, input);
			}
		}

		const payload = await parseResponseBody(response);
		if (!payload.ok) {
			return {
				data: null,
				error: buildInvalidResponseError({
					fallbackMessage: input.fallbackMessage,
					reason: payload.reason,
					response,
				}),
			};
		}

		return {
			data: payload.value as Data | null,
			error: null,
		};
	} catch (error) {
		return {
			data: null,
			error: toAuthError(error, input.fallbackMessage, 500, "Network Error"),
		};
	}
}

function buildAuthFetchRequestInit(request: AuthRequestInit): RequestInit {
	const {
		credentials: _ignoredCredentials,
		headers: _ignoredHeaders,
		...rest
	} = request as RequestInit;
	return {
		...rest,
		credentials: "include",
		headers: buildAuthRequestHeaders(request),
	};
}

function buildInvalidResponseError(input: {
	fallbackMessage: string;
	reason: "invalid_json" | "read_error";
	response: Response;
}): AuthClientError {
	return {
		code: "invalid_response",
		message: input.fallbackMessage,
		status: input.reason === "read_error" ? 500 : input.response.status,
		statusText:
			input.reason === "read_error"
				? "Response Read Error"
				: "Invalid Response",
	};
}

function buildAuthRequestHeaders(request: AuthRequestInit): Headers {
	const headers = new Headers({
		accept: "application/json",
		...(request.body ? { "content-type": "application/json" } : {}),
	});

	if (request.headers) {
		const requestHeaders = new Headers(request.headers);
		requestHeaders.forEach((value, key) => {
			headers.set(key, value);
		});
	}

	return headers;
}

function readRedirectErrorResult(
	response: Response,
	input: RequestAuthEndpointInput
): AuthTransportResult<never> | null {
	if (
		input.redirectErrorHandling !== "enabled" ||
		response.status < 300 ||
		response.status >= 400
	) {
		return null;
	}

	const location = response.headers.get("location");
	const redirectError = location ? extractRedirectErrorFromUrl(location) : null;
	if (!redirectError) {
		return buildSessionNotEstablishedRedirectResult(response, input);
	}

	return {
		data: null,
		error: toAuthError(
			buildRedirectAuthErrorPayload(redirectError),
			input.fallbackMessage,
			400,
			"Bad Request"
		),
	};
}

function buildSessionNotEstablishedRedirectResult(
	response: Response,
	input: RequestAuthEndpointInput
): AuthTransportResult<never> {
	const isUnfollowedRedirect = response.status >= 300 && response.status < 400;
	return {
		data: null,
		error: toAuthError(
			{
				code: "session_not_established",
				message:
					"Authentication redirected before OpenMeld confirmed a signed-in session.",
			},
			input.fallbackMessage,
			isUnfollowedRedirect ? response.status : 409,
			isUnfollowedRedirect
				? response.statusText || "Redirect"
				: "Session Not Established"
		),
	};
}

function buildRedirectAuthErrorPayload(
	redirectedError: RedirectedAuthError
): AuthClientError {
	return {
		code: redirectedError.code,
		...(redirectedError.description
			? { description: redirectedError.description }
			: {}),
		message: redirectedError.description
			? `${redirectedError.code}: ${redirectedError.description}`
			: redirectedError.code,
	};
}

function extractRedirectErrorFromUrl(url: string): RedirectedAuthError | null {
	try {
		const parsed = new URL(
			url,
			typeof window === "undefined"
				? "http://localhost"
				: window.location.origin
		);
		const code = readOptionalText(parsed.searchParams.get("error"));
		if (!code) {
			return null;
		}

		const description = readOptionalText(
			parsed.searchParams.get("error_description")
		);
		return {
			code,
			...(description ? { description } : {}),
		};
	} catch {
		return null;
	}
}
