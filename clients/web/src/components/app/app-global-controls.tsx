"use client";

import { useState } from "react";
import { GlobalInboxLauncher } from "#/components/inbox/global-inbox-launcher";
import { GlobalCenterAgentLauncher } from "#/components/organizations/global-center-agent-launcher";
import { CurrentComputerToolbarLauncher } from "./current-computer-toolbar-launcher";

export type AppGlobalPanel = "center_agent" | "inbox";

export type AppGlobalControlsProps = {
	hideCenterAgent?: boolean;
	currentPathname?: string;
	onOpenPanelChange?: (panel: AppGlobalPanel | null) => void;
	openPanel?: AppGlobalPanel | null;
};

export function AppGlobalControls(input: AppGlobalControlsProps = {}) {
	const [internalOpenPanel, setInternalOpenPanel] =
		useState<AppGlobalPanel | null>(null);
	const controlled = input.openPanel !== undefined;
	const openPanel = controlled ? input.openPanel : internalOpenPanel;
	const setOpenPanel = (panel: AppGlobalPanel | null) => {
		if (!controlled) {
			setInternalOpenPanel(panel);
		}
		input.onOpenPanelChange?.(panel);
	};
	return (
		<div
			aria-label="Global controls"
			className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] min-w-0 items-center justify-between gap-1 overflow-hidden px-2 pb-[env(safe-area-inset-bottom)] transition-[height] duration-180 ease-out motion-reduce:transition-none lg:h-[var(--app-toolbar-height,3rem)] lg:gap-0.5 lg:ps-0 lg:pe-2 lg:pb-0 lg:group-has-[>[data-slot=app-inline-navigation]>[data-main-sidebar-mode=hidden]]/app-surface:ps-10 [&_a]:min-h-11 [&_a]:touch-manipulation lg:[&_a]:min-h-0 [&_button]:min-h-11 [&_button]:touch-manipulation lg:[&_button]:min-h-0"
			data-slot="app-global-controls"
			role="toolbar"
		>
			<div
				className="flex min-w-0 items-center"
				data-slot="app-global-controls-start"
			>
				<CurrentComputerToolbarLauncher />
			</div>
			<div
				className="flex min-w-0 items-center gap-1 lg:gap-0.5"
				data-slot="app-global-controls-end"
			>
				<GlobalCenterAgentLauncher
					currentPathname={input.currentPathname}
					onOpenChange={(open) => setOpenPanel(open ? "center_agent" : null)}
					open={openPanel === "center_agent"}
				/>
				<GlobalInboxLauncher
					onOpenChange={(open) => setOpenPanel(open ? "inbox" : null)}
					open={openPanel === "inbox"}
				/>
			</div>
		</div>
	);
}
