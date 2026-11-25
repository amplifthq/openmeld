import { organizationDashboardArtifactSchema } from "@openmeld/schemas";
import { ChartBarIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { DashboardsPage } from "#/components/dashboard/dashboards-page";
import { SpaceWindowHeader } from "#/components/spaces/space-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/dashboard")({
	staticData: appShellStaticData.dashboard,
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	validateSearch: z.object({
		id: z.string().trim().min(1).max(256).optional().catch(undefined),
		draftKind: z
			.enum(["github_issues", "ugc", "traffic"])
			.optional()
			.catch(undefined),
		draftName: z.string().trim().min(1).max(100).optional().catch(undefined),
		draftArtifactSpaceId: organizationDashboardArtifactSchema.shape.spaceId
			.optional()
			.catch(undefined),
		draftArtifactFileId: organizationDashboardArtifactSchema.shape.fileId
			.optional()
			.catch(undefined),
		draftArtifactRevision: z.coerce
			.number()
			.int()
			.min(1)
			.max(Number.MAX_SAFE_INTEGER)
			.optional()
			.catch(undefined),
		draftRepository: z
			.string()
			.trim()
			.max(140)
			.regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)
			.optional()
			.catch(undefined),
	}),
	component: DashboardRoute,
});

function DashboardRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const {
		id,
		draftKind,
		draftName,
		draftRepository,
		draftArtifactSpaceId,
		draftArtifactFileId,
		draftArtifactRevision,
	} = Route.useSearch();
	const artifact =
		draftArtifactSpaceId && draftArtifactFileId && draftArtifactRevision
			? {
					spaceId: draftArtifactSpaceId,
					fileId: draftArtifactFileId,
					revision: draftArtifactRevision,
				}
			: undefined;
	const prefill =
		!id && draftKind && draftName
			? {
					kind: draftKind,
					name: draftName,
					repository: draftRepository,
					artifact,
				}
			: undefined;
	return (
		<AppFullWidthLayout
			initialOuterSidebarState={sidebarStates.outer}
			mainHeader={
				<SpaceWindowHeader
					leadingControl={
						<ChartBarIcon className="size-4 text-muted-foreground" />
					}
					renderFrame={false}
					title="Dashboard"
				/>
			}
			showMainHeader
		>
			<DashboardsPage
				accountId={currentUserId}
				id={id}
				key={JSON.stringify([
					currentUserId,
					currentOrganization.id,
					id,
					prefill,
				])}
				organizationId={currentOrganization.id}
				orgSlug={currentOrganization.slug}
				prefill={prefill}
			/>
		</AppFullWidthLayout>
	);
}
