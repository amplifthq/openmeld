import { useRouterState } from "@tanstack/react-router";
import { withRedirectQueryFromSearch } from "#/lib/auth-redirect";

export function useRedirectQueryPath(
	path: string,
	extraSearch?: Record<string, string | null | undefined>
): string {
	const locationSearch = useRouterState({
		select: (state) => state.location.search,
	});

	return withRedirectQueryFromSearch(path, locationSearch, extraSearch);
}
