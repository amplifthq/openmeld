import { resolveProfileResponseSchema } from "@openmeld/schemas";

export type SelectedSpaceProfile = {
	openMeldProfileId: string;
	profileKind: "human" | "agent";
	profileName: string;
	ownerUserId: string;
	ownerName?: string;
};

export class SelectedSpaceProfileAccessError extends Error {
	readonly status: 401 | 403;
	readonly setCookies: string[];

	constructor(status: 401 | 403, headers: Headers) {
		super(`Failed to resolve selected space profile: ${status}`);
		this.name = "SelectedSpaceProfileAccessError";
		this.status = status;
		this.setCookies = headers.getSetCookie();
	}
}

export async function readSelectedSpaceProfileFromRequest(input: {
	requestHeaders: Headers;
	authBaseUrl: string;
	openMeldProfileId: string;
	fetchImpl?: typeof fetch;
}): Promise<SelectedSpaceProfile> {
	const openMeldProfileId = input.openMeldProfileId.trim();
	if (!openMeldProfileId) {
		throw new Error("Selected space profile requires openMeldProfileId.");
	}

	const headers = new Headers({
		accept: "application/json",
		"content-type": "application/json",
	});
	const cookie = input.requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}

	const response = await (input.fetchImpl ?? fetch)(
		new URL("/v1/profiles/resolve", input.authBaseUrl),
		{
			method: "POST",
			headers,
			body: JSON.stringify({
				openMeldProfileId,
			}),
		}
	);
	if (response.status === 401 || response.status === 403) {
		throw new SelectedSpaceProfileAccessError(
			response.status,
			response.headers
		);
	}
	if (!response.ok) {
		throw new Error(
			`Failed to resolve selected space profile: ${response.status}`
		);
	}

	const payload = await response.json();
	const parsed = resolveProfileResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw new Error(
			`Invalid selected space profile response: ${parsed.error.message}`
		);
	}

	const { profile } = parsed.data;
	if (!profile.ownerUserId) {
		throw new Error("Selected space profile requires a personal owner.");
	}
	return {
		openMeldProfileId: profile.openMeldProfileId,
		profileKind: profile.profileKind,
		profileName: profile.profileName,
		ownerUserId: profile.ownerUserId,
		...(profile.ownerName ? { ownerName: profile.ownerName } : {}),
	};
}
