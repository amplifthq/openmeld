export function isDevtoolsEnabled(options?: {
	isDevelopment?: boolean;
	search?: string | URLSearchParams;
}) {
	const isDevelopment = options?.isDevelopment ?? import.meta.env.DEV;
	if (!isDevelopment) {
		return false;
	}

	const searchValue =
		options?.search ??
		(typeof window === "undefined" ? "" : window.location.search);

	const searchParams =
		typeof searchValue === "string"
			? new URLSearchParams(searchValue)
			: searchValue;

	return searchParams.get("devtools") === "1";
}
