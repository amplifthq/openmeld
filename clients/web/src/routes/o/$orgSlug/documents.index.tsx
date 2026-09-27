import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/o/$orgSlug/documents/")({
	validateSearch: (search: Record<string, unknown>) => ({
		folder:
			typeof search.folder === "string" && search.folder.trim()
				? search.folder.trim()
				: undefined,
	}),
	beforeLoad: ({ params, search }) => {
		throw redirect({
			to: "/o/$orgSlug/files",
			params,
			search: { view: "knowledge", folder: search.folder },
			replace: true,
		});
	},
});
