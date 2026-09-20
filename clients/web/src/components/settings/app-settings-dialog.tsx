import { Dialog } from "@openmeld/ui/components/dialog";
import {
	useLocation,
	useNavigate,
	useParams,
	useSearch,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { useCurrentComputer } from "#/components/app/current-computer";
import { getDesktopPlatform } from "#/desktop/platform";
import { buildOrganizationInboxPath } from "#/lib/organizations/organization-routes";
import { SettingsPage } from "./settings-page";
import { type AppSettingsSection, useAppSettings } from "./use-app-settings";

export default function AppSettingsDialog() {
	const { appSettings } = useSearch({ strict: false });
	const navigate = useNavigate({ from: "/o/$orgSlug" });
	const pathname = useLocation({ select: (location) => location.pathname });
	const { orgSlug } = useParams({ strict: false });
	const openSettings = useAppSettings();
	const computer = useCurrentComputer();
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
				if (document.body.inert) {
					return;
				}
				if (destination === "settings") {
					openSettings().catch(console.error);
				} else if (destination === "inbox" && orgSlug) {
					navigate({
						to: buildOrganizationInboxPath(orgSlug),
					}).catch(console.error);
				} else if (destination === "computer" && computer?.destination) {
					navigate({ to: computer.destination }).catch(console.error);
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
	}, [computer?.destination, navigate, openSettings, orgSlug]);
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
