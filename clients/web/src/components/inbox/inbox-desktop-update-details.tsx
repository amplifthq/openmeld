import type { InboxItem } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useAppSettings } from "#/components/settings/use-app-settings";
import { useDesktopUpdater } from "#/desktop/updater";

export function InboxDesktopUpdateDetails({
	target,
}: {
	target: Extract<InboxItem["sourceTarget"], { kind: "desktop_update" }>;
}) {
	const native = useDesktopUpdater();
	const openSettings = useAppSettings();
	const local =
		native?.installationId === target.installationId &&
		native.lane === target.lane;
	if (target.state === "installed") {
		return null;
	}
	if (target.state === "superseded") {
		return (
			<p className="px-4 py-3 text-muted-foreground text-sm">
				This version is no longer offered. Check Updates in Desktop for the
				current release.
			</p>
		);
	}
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
			<p className="min-w-0 flex-1 text-muted-foreground">
				{local
					? "Updates will check the latest native installation state before offering an action."
					: `Open OpenMeld Desktop on ${target.deviceName}, then go to Settings → Updates. This browser or installation cannot install an update on that device.`}
			</p>
			{local ? (
				<Button
					onClick={() => {
						openSettings("updates").catch(console.error);
					}}
					size="sm"
					variant="outline"
				>
					Open Updates
				</Button>
			) : null}
		</div>
	);
}
