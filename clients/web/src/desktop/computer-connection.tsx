import { desktopComputerConnectionResultSchema } from "@openmeld/schemas";
import type { PrepareSessionSnapshot } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useState } from "react";
import { useBringAgentsSetupContext } from "#/components/connect/bring-agents-setup-context";
import { useAuthSession } from "#/hooks/auth.hooks";
import { getDesktopPlatform } from "./platform";

export function DesktopComputerConnection(input: {
	onCompleted?: (
		connection: Pick<PrepareSessionSnapshot, "deviceId" | "runtimeLane">
	) => void;
	onContinue?: () => void;
}) {
	const setup = useBringAgentsSetupContext();
	const session = useAuthSession();
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const [diagnosticId, setDiagnosticId] = useState<string | null>(null);
	const expectedAccount = session.data?.user.id;
	const connect = async () => {
		const desktop = getDesktopPlatform();
		if (!(desktop && expectedAccount)) {
			return;
		}
		setPending(true);
		setFailed(false);
		setDiagnosticId(null);
		setMessage(null);
		try {
			const result = desktopComputerConnectionResultSchema.parse(
				await desktop.connectComputer({
					expectedAccount,
					humanProfileId: setup.selectedHumanProfileId,
					targetSpaceId: setup.targetSpaceId,
				})
			);
			if (result.status === "cancelled") {
				setMessage("The current computer connection was kept.");
				return;
			}
			if (result.status === "failed") {
				setFailed(true);
				setMessage(result.message);
				setDiagnosticId(result.diagnosticId);
				return;
			}
			await setup.localRuntimesQuery.refetch();
			input.onCompleted?.(
				result.status === "completed" ? result.snapshot : result.connection
			);
			setMessage(
				result.status === "completed"
					? "This computer is connected."
					: "Using this computer's existing connection."
			);
			input.onContinue?.();
		} catch (error) {
			setFailed(true);
			setMessage(
				error instanceof Error
					? error.message
					: "This computer could not connect. Try again."
			);
		} finally {
			setPending(false);
		}
	};
	return (
		<div className="space-y-3">
			<div>
				<p className="font-medium text-sm">Connect this computer</p>
				<p className="text-muted-foreground text-sm">
					Desktop connects this Mac using OpenMeld Tools. Your agents can keep
					working after you quit Desktop.
				</p>
			</div>
			<Button
				disabled={pending || !expectedAccount || !setup.selectedHumanProfileId}
				onClick={connect}
				type="button"
			>
				{pending ? "Connecting…" : "Connect this computer"}
			</Button>
			{diagnosticId ? (
				<details className="text-muted-foreground text-xs">
					<summary>Connection details</summary>
					<p>{diagnosticId}</p>
				</details>
			) : null}
			{message ? (
				<p className="text-sm" role={failed ? "alert" : "status"}>
					{message}
				</p>
			) : null}
		</div>
	);
}
