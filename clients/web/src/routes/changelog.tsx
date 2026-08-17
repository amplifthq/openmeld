import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "#/components/changelog/changelog-page";
import { readPublishedChangelog } from "#/lib/changelog/read-changelog";
import { buildPublicPageHead } from "#/lib/site";

const CHANGELOG_DESCRIPTION =
	"See the latest OpenMeld features, improvements, fixes, and important product changes from the official Git-backed Changelog.";

export const Route = createFileRoute("/changelog")({
	head: () =>
		buildPublicPageHead({
			description: CHANGELOG_DESCRIPTION,
			path: "/changelog",
			title: "Changelog",
		}),
	loader: loadChangelogPage,
	component: ChangelogRoute,
});

export async function loadChangelogPage() {
	try {
		return {
			initialPage: await readPublishedChangelog({ data: { limit: 10 } }),
		};
	} catch (error) {
		console.error("[web.changelog.initial_read_failed]", {
			error: error instanceof Error ? error.message : String(error),
		});
		return { initialPage: null };
	}
}

function ChangelogRoute() {
	const { initialPage } = Route.useLoaderData();
	return <ChangelogPage initialPage={initialPage} />;
}
