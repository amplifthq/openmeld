import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { DesktopDownloadPage } from "#/components/desktop-download/desktop-download-page";
import {
	parseDesktopCandidateSelector,
	parseDesktopPlatformSelector,
	readAvailableDesktopRelease,
} from "#/lib/desktop-release";

const readDesktopDownload = createServerFn({ method: "GET" })
	.validator((value: { candidate?: string; platform?: string }) => ({
		candidate: parseDesktopCandidateSelector(value.candidate),
		platform: parseDesktopPlatformSelector(value.platform),
	}))
	.handler(async ({ data }) => {
		const { env } = await import("cloudflare:workers");
		return readAvailableDesktopRelease(
			env.OPENMELD_DESKTOP_DOWNLOADS,
			data.candidate,
			data.platform
		);
	});

export const Route = createFileRoute("/desktop")({
	validateSearch: (search) => ({
		candidate: parseDesktopCandidateSelector(search.candidate),
		platform: parseDesktopPlatformSelector(search.platform),
	}),
	loaderDeps: ({ search }) => ({
		candidate: search.candidate,
		...(search.platform ? { platform: search.platform } : {}),
	}),
	loader: ({ deps }) => readDesktopDownload({ data: deps }),
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
	const { candidate, platform } = Route.useSearch();
	return (
		<DesktopDownloadPage
			platform={platform}
			release={Route.useLoaderData()}
			unavailable={candidate ? "candidate" : "default"}
		/>
	);
}
