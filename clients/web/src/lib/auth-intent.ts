export const ADD_ACCOUNT_AUTH_INTENT = "add-account";

const INTERNAL_URL_BASE = "https://openmeld.ai";

export function hasAddAccountAuthIntent(locationHref: string): boolean {
	const parsedLocation = new URL(locationHref, INTERNAL_URL_BASE);
	return parsedLocation.searchParams.get("intent") === ADD_ACCOUNT_AUTH_INTENT;
}
