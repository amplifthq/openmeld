export function buildPublicSpaceShareUrl(input: {
	origin: string | null;
	spaceId: string;
}): string {
	const path = `/spaces/${encodeURIComponent(input.spaceId)}`;
	if (!input.origin) {
		return path;
	}

	return new URL(path, input.origin).toString();
}
