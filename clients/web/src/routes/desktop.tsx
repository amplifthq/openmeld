import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { DesktopDownloadPage } from "#/components/desktop-download/desktop-download-page";
import {
	parseDesktopCandidateSelector,
	readAvailableDesktopRelease,
} from "#/lib/desktop-release";

const readDesktopDownload = createServerFn({ method: "GET" })
	.validator(parseDesktopCandidateSelector)
	.handler(async ({ data }) => {
		const { env } = await import("cloudflare:workers");
		return readAvailableDesktopRelease(env.OPENMELD_DESKTOP_DOWNLOADS, data);
	});

export const Route = createFileRoute("/desktop")({
	validateSearch: (search) => ({
		candidate: parseDesktopCandidateSelector(search.candidate),
	}),
	loaderDeps: ({ search }) => ({ candidate: search.candidate }),
	loader: ({ deps }) => readDesktopDownload({ data: deps.candidate }),
	head: () => ({
		meta: [
			{ title: "OpenMeld Desktop Preview" },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: DesktopRoute,
	errorComponent: () => (
		<DesktopDownloadPage release={null} unavailable="invalid" />
	),
});

function DesktopRoute() {
	const { candidate } = Route.useSearch();
	return (
		<DesktopDownloadPage
			release={Route.useLoaderData()}
			unavailable={candidate ? "candidate" : "default"}
		/>
	);
}
