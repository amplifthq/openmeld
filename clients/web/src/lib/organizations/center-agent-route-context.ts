import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export async function loadCenterAgentRouteContext() {
	const { outer } = await getAppSidebarStatesForRoute();
	return {
		initialOuterSidebarState: outer,
	};
}
