import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export async function loadCenterAgentRouteContext() {
	const { inner, outer } = await getAppSidebarStatesForRoute("center-agent");
	return {
		initialInnerSidebarState: inner,
		initialOuterSidebarState: outer,
	};
}
