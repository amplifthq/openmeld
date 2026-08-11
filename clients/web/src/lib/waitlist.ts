import {
	joinWaitlistBodySchema,
	joinWaitlistResponseSchema,
	waitlistErrorResponseSchema,
} from "@openmeld/schemas";
import type {
	JoinWaitlistBody,
	JoinWaitlistResponse,
} from "@openmeld/schemas/types";
import { readResponseBody } from "./http-response";

export const WAITLIST_RATE_LIMIT_WINDOW_MS = 3 * 60 * 1000;

const WAITLIST_STORAGE_KEY_PREFIX = "openmeld.waitlist.lastSubmittedAt:";
const WAITLIST_REQUEST_ERROR_MESSAGE = "Failed to join the waitlist.";

export function validateWaitlistEmail(email: string) {
	return joinWaitlistBodySchema.safeParse({ email });
}

export function buildWaitlistStorageKey(email: string): string {
	return `${WAITLIST_STORAGE_KEY_PREFIX}${email}`;
}

export function getWaitlistRateLimitRemainingMs(
	email: string,
	now = Date.now()
): number {
	if (typeof window === "undefined") {
		return 0;
	}

	const storedValue = window.localStorage.getItem(
		buildWaitlistStorageKey(email)
	);
	if (!storedValue) {
		return 0;
	}

	const submittedAt = Number.parseInt(storedValue, 10);
	if (!Number.isFinite(submittedAt)) {
		window.localStorage.removeItem(buildWaitlistStorageKey(email));
		return 0;
	}

	return Math.max(0, submittedAt + WAITLIST_RATE_LIMIT_WINDOW_MS - now);
}

export function markWaitlistSubmitted(
	email: string,
	submittedAt = Date.now()
): void {
	if (typeof window === "undefined") {
		return;
	}

	window.localStorage.setItem(
		buildWaitlistStorageKey(email),
		String(submittedAt)
	);
}

export async function submitWaitlistEmail(
	input: JoinWaitlistBody
): Promise<JoinWaitlistResponse> {
	const response = await fetch("/api/waitlist", {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		body: JSON.stringify(input),
	});

	const payloadResult = await readResponseBody(response);
	if (!payloadResult.ok) {
		throw new Error(WAITLIST_REQUEST_ERROR_MESSAGE);
	}

	const payload = payloadResult.value;

	if (!response.ok) {
		const errorResult = waitlistErrorResponseSchema.safeParse(payload);
		if (errorResult.success) {
			throw new Error(errorResult.data.message);
		}

		throw new Error(WAITLIST_REQUEST_ERROR_MESSAGE);
	}

	const result = joinWaitlistResponseSchema.safeParse(payload);
	if (!result.success) {
		throw new Error(WAITLIST_REQUEST_ERROR_MESSAGE);
	}

	return result.data;
}
