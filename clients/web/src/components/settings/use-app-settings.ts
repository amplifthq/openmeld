import { useLocation, useNavigate } from "@tanstack/react-router";
import type { buildSettingsRoutes } from "#/lib/settings-routes";

export type AppSettingsSection = Exclude<
	keyof ReturnType<typeof buildSettingsRoutes>,
	"root" | "connectedApps"
>;

/** The URL owns the open section; no second dialog-navigation state. */
export function useAppSettings() {
	const navigate = useNavigate({ from: "/o/$orgSlug" });
	const pathname = useLocation({ select: (location) => location.pathname });
	return (section: AppSettingsSection = "account", replace = false) =>
		navigate({
			to: pathname,
			search: (previous) => ({ ...previous, appSettings: section }),
			replace,
			resetScroll: false,
		});
}
