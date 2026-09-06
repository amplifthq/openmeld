// Store identities only. Names, membership, and status always come from the
// current authorized account index, never from browser history.
export function recentSpaceIds(raw: string | null): string[] {
	try {
		const value: unknown = JSON.parse(raw ?? "[]");
		return Array.isArray(value)
			? [
					...new Set(
						value.filter((id): id is string => typeof id === "string")
					),
				].slice(0, 30)
			: [];
	} catch {
		return [];
	}
}

export function recordRecentSpace(
	ids: readonly string[],
	id: string
): string[] {
	return [id, ...ids.filter((previous) => previous !== id)].slice(0, 30);
}
