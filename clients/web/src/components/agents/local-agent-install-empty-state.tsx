import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	MagnifyingDock,
	MagnifyingDockItem,
} from "@openmeld/ui/components/magnifying-dock";
import type { ReactNode } from "react";
import { LOCAL_AGENT_EXAMPLE_IDS } from "#/components/profiles/local-agent-logo-stack";
import { getLocalAgentInstallGuide } from "#/lib/local-agent-install-guides";

export function LocalAgentInstallEmptyState(input: {
	description?: string;
	installGuide: ReactNode;
}) {
	return (
		<div
			className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-md border border-border/70 border-dashed bg-card/25 px-6 py-6 text-center"
			data-testid="local-agent-catalog-empty"
		>
			<p className="font-medium text-sm">No supported agents detected</p>
			<p className="max-w-md text-muted-foreground text-xs leading-5">
				{input.description ??
					"Install an agent such as Codex or Claude Code on this computer to get started."}
			</p>
			<MagnifyingDock
				aria-label="Supported agents"
				className="max-w-full flex-wrap justify-center gap-x-3 gap-y-4 px-2 pt-3 pb-2"
			>
				{LOCAL_AGENT_EXAMPLE_IDS.map((agentId) => (
					<MagnifyingDockItem
						caption={getLocalAgentInstallGuide(agentId)?.displayName ?? agentId}
						captionClassName="max-w-none whitespace-nowrap"
						key={agentId}
					>
						<LocalAgentLogo
							agentId={agentId}
							className="size-12"
							variant="tile"
						/>
					</MagnifyingDockItem>
				))}
			</MagnifyingDock>
			{input.installGuide}
		</div>
	);
}
