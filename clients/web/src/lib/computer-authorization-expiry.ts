export const DEFAULT_COMPUTER_AUTHORIZATION_EXPIRES_IN_SECONDS = 10 * 60;

export function resolveComputerAuthorizationHandoffExpiresAt(input: {
	authorizationExpiresInSeconds?: number;
	prepareSessionExpiresAt?: null | string;
	nowMs?: number;
}): string {
	const candidates: number[] = [];
	const prepareSessionExpiresAtMs = Date.parse(
		input.prepareSessionExpiresAt ?? ""
	);
	if (Number.isFinite(prepareSessionExpiresAtMs)) {
		candidates.push(prepareSessionExpiresAtMs);
	}

	const authorizationExpiresInSeconds =
		typeof input.authorizationExpiresInSeconds === "number" &&
		input.authorizationExpiresInSeconds > 0
			? input.authorizationExpiresInSeconds
			: DEFAULT_COMPUTER_AUTHORIZATION_EXPIRES_IN_SECONDS;
	candidates.push(
		(input.nowMs ?? Date.now()) + authorizationExpiresInSeconds * 1000
	);

	return new Date(Math.min(...candidates)).toISOString();
}
