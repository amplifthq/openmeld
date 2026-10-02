import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/o/$orgSlug/documents/$documentId")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/o/$orgSlug/files",
			params: { orgSlug: params.orgSlug },
			search: {
				view: "knowledge",
				document: params.documentId,
				folder: undefined,
				create: undefined,
				kind: undefined,
				subjectUserId: undefined,
			},
			replace: true,
		});
	},
});
