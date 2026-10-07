import { TabItem, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { CloudIcon, DesktopTowerIcon } from "@phosphor-icons/react";
import { LocalAgentLogoStack } from "./local-agent-logo-stack";

export function AgentRuntimeChoice({
	runtime,
	onChange,
}: {
	runtime: "local" | "remote";
	onChange: (value: "local" | "remote") => void;
}) {
	return (
		<Tabs
			className="max-w-3xl"
			onValueChange={(value) =>
				onChange(value === "local" ? "local" : "remote")
			}
			value={runtime}
		>
			<TabsList
				aria-label="Agent runtime"
				background={false}
				className="grid grid-cols-2 items-stretch gap-2"
			>
				<TabItem
					aria-label="Choose a Local Agent"
					className="h-auto min-h-24 items-start gap-3 rounded-md border border-border border-dashed p-4 text-left aria-selected:border-transparent aria-selected:border-solid"
					label="Choose a Local Agent"
					value="local"
				>
					<DesktopTowerIcon
						aria-hidden="true"
						className="mt-0.5 size-5 shrink-0"
					/>
					<span className="grid gap-1">
						<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
							<span className="font-medium text-sm">Choose a Local Agent</span>
							<LocalAgentLogoStack compact />
						</span>
						<span className="text-muted-foreground text-xs">
							Runs on your computer.
						</span>
					</span>
				</TabItem>
				<TabItem
					aria-label="Remote Agent"
					className="h-auto min-h-24 items-start gap-3 rounded-md border border-border border-dashed p-4 text-left aria-selected:border-transparent aria-selected:border-solid"
					label="Remote Agent"
					value="remote"
				>
					<CloudIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
					<span className="grid gap-1">
						<span className="font-medium text-sm">Remote Agent</span>
						<span className="text-muted-foreground text-xs">
							Runs in the cloud.
						</span>
					</span>
				</TabItem>
			</TabsList>
		</Tabs>
	);
}
