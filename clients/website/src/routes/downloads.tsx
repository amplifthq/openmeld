import { buildPublicPageHead } from "@openmeld/product-catalog/site";
import { desktopDownloadQuerySchema } from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { DesktopDownloadsPage } from "#/components/desktop-downloads";
import { readDesktopDownloads } from "#/lib/read-desktop-downloads";

export const Route = createFileRoute("/downloads")({
	validateSearch: (search) =>
		desktopDownloadQuerySchema.parse({
			...(search.candidate !== undefined
				? { candidate: search.candidate }
				: {}),
			...(search.platform !== undefined ? { platform: search.platform } : {}),
		}),
	loaderDeps: ({ search }) => search,
	loader: async ({ deps }) => ({
		downloads: await readDesktopDownloads({ data: deps }),
		candidate: deps.candidate,
	}),
	head: ({ loaderData }) =>
		buildPublicPageHead({
			path: "/downloads",
			title: "Downloads",
			...(loaderData?.candidate
				? { robots: "noindex, nofollow", includeCanonical: false }
				: {}),
			description:
				"Download OpenMeld Desktop for macOS or Windows. Use the same account as OpenMeld Web.",
		}),
	component: DownloadsPage,
	errorComponent: () => <DesktopDownloadsPage downloads={null} unavailable />,
});

function DownloadsPage() {
	const { candidate, downloads } = Route.useLoaderData();
	return (
		<DesktopDownloadsPage
			candidate={Boolean(candidate)}
			downloads={downloads}
		/>
	);
}
