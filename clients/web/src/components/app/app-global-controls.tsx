"use client";

import { useState } from "react";
import { GlobalInboxLauncher } from "#/components/inbox/global-inbox-launcher";
import {
	GlobalCenterAgentLauncher,
	GlobalCenterAgentTaskLaunchers,
} from "#/components/organizations/global-center-agent-launcher";

export type AppGlobalPanel = "center_agent" | "inbox" | `task:${string}`;

export type AppGlobalControlsProps = {
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
	const openTaskId = openPanel?.startsWith("task:")
		? openPanel.slice("task:".length)
		: null;
	return (
		<div
			aria-label="Global controls"
			className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex h-9 min-w-0 items-center justify-end gap-0.5 overflow-hidden pe-2"
			data-slot="app-global-controls"
			role="toolbar"
		>
			<GlobalCenterAgentTaskLaunchers
				currentPathname={input.currentPathname}
				onOpenTaskChange={(taskId, open) =>
					setOpenPanel(open ? `task:${taskId}` : null)
				}
				openTaskId={openTaskId}
			/>
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
	);
}
