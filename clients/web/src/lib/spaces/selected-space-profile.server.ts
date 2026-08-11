import { resolveProfileResponseSchema } from "@openmeld/schemas";

export type SelectedSpaceProfile = {
	openMeldProfileId: string;
	profileKind: "human" | "agent";
	profileName: string;
	ownerUserId: string;
	ownerName?: string;
};

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
	return {
		openMeldProfileId: profile.openMeldProfileId,
		profileKind: profile.profileKind,
		profileName: profile.profileName,
		ownerUserId: profile.ownerUserId,
		...(profile.ownerName ? { ownerName: profile.ownerName } : {}),
	};
}
