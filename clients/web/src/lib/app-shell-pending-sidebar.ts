import {
	getAppSidebarStatesForRoute,
	type SidebarPersistedState,
} from "#/lib/sidebar-width-cookie";

/**
 * The persisted module sidebar geometry, read from the request cookie during
 * SSR and from `document.cookie` in the browser. The Organization route is
 * client-only, so its pending shell is the first server-rendered frame; it
 * must use the same width the real shell will mount with.
 */
export async function readAppShellPendingSidebarState(): Promise<SidebarPersistedState> {
	return (await getAppSidebarStatesForRoute()).outer;
}
