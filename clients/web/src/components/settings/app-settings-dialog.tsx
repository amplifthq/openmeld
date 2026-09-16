import { Dialog } from "@openmeld/ui/components/dialog";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { SettingsPage } from "./settings-page";
import { type AppSettingsSection, useAppSettings } from "./use-app-settings";

export default function AppSettingsDialog() {
	const { appSettings } = useSearch({ strict: false });
	const navigate = useNavigate({ from: "/o/$orgSlug" });
	const pathname = useLocation({ select: (location) => location.pathname });
	const openSettings = useAppSettings();
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					navigate({
						to: pathname,
						search: ({ appSettings: _section, ...previous }) => previous,
						replace: true,
						resetScroll: false,
					});
				}
			}}
			open={Boolean(appSettings)}
		>
			{appSettings ? (
				<SettingsPage
					activeSectionId={appSettings}
					onNavigate={(section) =>
						openSettings(section as AppSettingsSection, true)
					}
					presentation="dialog"
				/>
			) : null}
		</Dialog>
	);
}
