import { Dialog } from "@openmeld/ui/components/dialog";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { getDesktopPlatform } from "#/desktop/platform";
import { SettingsPage } from "./settings-page";
import { type AppSettingsSection, useAppSettings } from "./use-app-settings";

export default function AppSettingsDialog() {
	const { appSettings } = useSearch({ strict: false });
	const navigate = useNavigate({ from: "/o/$orgSlug" });
	const pathname = useLocation({ select: (location) => location.pathname });
	const openSettings = useAppSettings();
	useEffect(() => {
		const bridge = getDesktopPlatform();
		if (!bridge) {
			return;
		}
		let unsubscribe: (() => void) | undefined;
		const subscribe = () => {
			if (document.body.inert || unsubscribe) {
				return;
			}
			observer.disconnect();
			unsubscribe = bridge.onWindowDestinationChange((destination) => {
				// Native menu intents must respect the updater's interaction freeze too.
				if (destination === "settings" && !document.body.inert) {
					openSettings().catch(console.error);
				}
			});
		};
		// During initial updater admission, leave an early intent in preload's
		// existing buffer until editing is allowed. Do not invent dialog state.
		const observer = new MutationObserver(subscribe);
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ["inert"],
		});
		subscribe();
		return () => {
			observer.disconnect();
			unsubscribe?.();
		};
	}, [openSettings]);
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
