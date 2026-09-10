import type { PrepareSessionSnapshot } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { type PropsWithChildren, use, useEffect, useState } from "react";
import { StartSetupCommandCard } from "../../src/components/connect/start-setup-command-card";
import { PreviewState } from "./preview-state";

export function BringAgentsSetupProvider({ children }: PropsWithChildren) {
	return children;
}

export function ComputerSetupFlow(input: {
	onCompleted: (snapshot: PrepareSessionSnapshot) => void;
}) {
	const { stage, setStage, setScenario } = use(PreviewState);
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (stage !== "completed") {
			return;
		}
		setScenario("ready");
		input.onCompleted({
			prepareSessionId: "preview-setup",
			deviceId: "office-mac",
			runtimeLane: "dev-local",
		} as PrepareSessionSnapshot);
	}, [input.onCompleted, setScenario, stage]);
	if (stage === "failed") {
		return (
			<div className="grid gap-3 rounded-md border p-4" role="alert">
				<p className="font-medium text-sm">
					Couldn’t finish connecting this computer
				</p>
				<p className="text-muted-foreground text-sm">
					Your Agent settings are still here. Try the connection again.
				</p>
				<Button
					className="justify-self-start"
					onClick={() => setStage("command")}
					type="button"
					variant="outline"
				>
					Try connection again
				</Button>
			</div>
		);
	}
	return (
		<StartSetupCommandCard
			command="# Preview only — use the simulation controls above"
			commandPlaceholder="Preparing command…"
			copyLabel="Copy command"
			copyStatus={copied ? "copied" : "idle"}
			expiresInLabel={null}
			isLoading={false}
			onCopyCommand={() => {
				setCopied(true);
				return Promise.resolve();
			}}
			statusText={
				stage === "connecting"
					? "Connecting computer…"
					: "Waiting for you to run the command"
			}
			title="Run one command on your computer"
		/>
	);
}
