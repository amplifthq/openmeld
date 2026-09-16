import { Dialog } from "@openmeld/ui/components/dialog";
import { SettingsDialogContent } from "@openmeld/ui/components/settings-dialog-content";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { type AppSettingsSection, useAppSettings } from "./use-app-settings";

const SettingsPage = lazy(() =>
	import("./settings-page").then((module) => ({ default: module.SettingsPage }))
);

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
				<Suspense
					fallback={
						<SettingsDialogContent
							description="Manage your account and organization preferences."
							navigation={null}
							spacious
							title="App settings"
						>
							<output>Loading settings…</output>
						</SettingsDialogContent>
					}
				>
					<SettingsPage
						activeSectionId={appSettings}
						onNavigate={(section) =>
							openSettings(section as AppSettingsSection, true)
						}
						presentation="dialog"
					/>
				</Suspense>
			) : null}
		</Dialog>
	);
}
