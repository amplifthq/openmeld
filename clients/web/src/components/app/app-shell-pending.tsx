import { OpenMeldLoadingScreen } from "@openmeld/ui/components/openmeld-loading-screen";
import { getRouteApi, useLocation } from "@tanstack/react-router";
import { SidebarListSkeleton } from "#/components/app/sidebar-list-skeleton";
import { SpaceLandingLoadingShell } from "#/components/spaces/space-state-surfaces";
import { AppMainContent } from "./app-main-content";
import { AppModuleSidebarHeader } from "./app-module-sidebar-header";
import { APP_APPLICATION_RAIL_CLASS_NAME } from "./app-nav-item-style";
import { AppSurfaceLayout } from "./app-surface-layout";

const rootRoute = getRouteApi("__root__");

// A conversation URL: /o/<org>/spaces/<id> or /o/<org>/chats/<id>.
const CONVERSATION_PATH_PATTERN = /^\/o\/[^/]+\/(spaces|chats)\/[^/]+\/?$/;

/**
 * The first frame of a hard refresh while the account, Organization and route
 * code load. A conversation URL paints the conversation frame (rail, sidebar,
 * header, message area and composer) so that content later fills it in place;
 * any other URL keeps the full-screen loading screen.
 */
export function AppShellPending() {
	const pathname = useLocation({ select: (location) => location.pathname });
	const sidebarState = rootRoute.useLoaderData({
		select: (data) => data?.appShellSidebarState,
	});
	if (!CONVERSATION_PATH_PATTERN.test(pathname)) {
		return <OpenMeldLoadingScreen />;
	}
	return (
		<AppSurfaceLayout
			ariaBusy
			defaultModuleSidebarOpen
			frameSlotName="space-window-frame"
			globalControls={null}
			initialModuleSidebarState={sidebarState}
			moduleNavigation={
				<>
					<AppModuleSidebarHeader title="Spaces" />
					<SidebarListSkeleton
						label="Loading conversations"
						rowCount={2}
						showPreview
					/>
				</>
			}
			moduleNavigationLabel="Spaces"
			outerRail={
				<aside
					aria-hidden="true"
					className={APP_APPLICATION_RAIL_CLASS_NAME}
					data-slot="app-outer-rail-pending"
				/>
			}
		>
			<section className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
				<AppMainContent bodyClassName="flex" showHeader={false}>
					<SpaceLandingLoadingShell membersOpen={false} />
				</AppMainContent>
			</section>
		</AppSurfaceLayout>
	);
}
