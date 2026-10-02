/** A transient refresh failure may keep display data; rejected access may not. */
export function mayShowCachedReadData(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return true;
	}
	return ![401, 403, 404].includes(Number(error.status));
}
