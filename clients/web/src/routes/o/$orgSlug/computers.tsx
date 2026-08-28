import {
	createFileRoute,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { z } from "zod/v4";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { ComputersPage } from "#/components/computers/computers-page";
import {
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
	buildOrganizationPeoplePath,
} from "#/lib/organizations/organization-routes";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

const computersRouteSearchSchema = z.object({
	focus: z.enum(["file-access", "service"]).optional(),
	refresh: z.literal("setup-complete").optional(),
});

export const Route = createFileRoute("/o/$orgSlug/computers")({
	staticData: appShellStaticData.computers,
	validateSearch: (search) => {
		const parsed = computersRouteSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	component: ComputersRoute,
});

function ComputersRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { orgSlug } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const params = useParams({ strict: false });
	const selectedDeviceId =
		typeof params.deviceId === "string" ? params.deviceId : null;

	return (
		<AppFullWidthLayout initialOuterSidebarState={sidebarStates.outer}>
			<ComputersPage
				routeState={{
					computersFocusFileAccess: search.focus === "file-access",
					computersFocusService: search.focus === "service",
					computersSelectedDeviceId: selectedDeviceId,
					computersSetupCompleteRefresh: search.refresh === "setup-complete",
					onComputerRouteUnavailable: () => {
						navigate({
							replace: true,
							to: buildOrganizationPeoplePath(orgSlug),
						}).catch((error: unknown) => {
							console.error("Failed to return to People.", error);
						});
					},
					onComputerRouteResolved: (deviceId) => {
						navigate({
							params: { deviceId },
							replace: true,
							search,
							to: buildOrganizationComputerPath({ deviceId, orgSlug }),
						}).catch((error: unknown) => {
							console.error("Failed to open Computer details.", error);
						});
					},
					onFocusConsumed: () => {
						if (!(search.focus || search.refresh)) {
							return;
						}
						const target = selectedDeviceId
							? buildOrganizationComputerPath({
									deviceId: selectedDeviceId,
									orgSlug,
								})
							: buildOrganizationComputersPath(orgSlug);
						navigate({
							replace: true,
							search: {},
							to: target,
						}).catch((error: unknown) => {
							console.error(
								"Failed to clear consumed Computer route state.",
								error
							);
						});
					},
				}}
			/>
		</AppFullWidthLayout>
	);
}
