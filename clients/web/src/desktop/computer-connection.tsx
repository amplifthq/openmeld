import { desktopComputerConnectionResultSchema } from "@openmeld/schemas";
import type {
	CreatePrepareSessionRequest,
	PrepareSessionSnapshot,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useState } from "react";
import { useBringAgentsSetupContext } from "#/components/connect/bring-agents-setup-context";
import { useAuthSession } from "#/hooks/auth.hooks";
import {
	buildConnectComputerPath,
	buildConnectRouteSearch,
} from "#/lib/connect/connect-route";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { getDesktopPlatform, openDesktopWeb } from "./platform";

export function DesktopComputerConnection(input: {
	orgSlug?: string;
	sourceNavigationAction?: CreatePrepareSessionRequest["sourceNavigationAction"];
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
	const intent = setup.routeIntent;
	const requiresWeb =
		intent.serviceAction === "update_service" ||
		intent.kind === "space_recovery";
	const connect = async () => {
		if (requiresWeb) {
			return;
		}
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
					resetThisComputer: intent.resetThisComputer,
					sourceNavigationAction: input.sourceNavigationAction,
					connectedComputerId: intent.connectedComputerId,
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
	if (requiresWeb) {
		const search = buildConnectRouteSearch(intent);
		const path =
			intent.kind === "space_recovery"
				? buildConnectComputerPath({
						...search,
						returnTo: "space",
						spaceId: intent.spaceId,
						agentProfileIds: intent.agentProfileIds,
						orgSlug: input.orgSlug,
					})
				: buildConnectComputerPath({
						...search,
						returnTo: intent.returnTo,
						orgSlug: input.orgSlug,
					});
		const destination = input.sourceNavigationAction
			? buildOrganizationSpacePath({
					orgSlug: input.orgSlug ?? "login",
					spaceId: input.sourceNavigationAction.spaceId,
				})
			: path;
		return (
			<div className="space-y-3">
				<p className="text-sm">
					Continue this computer recovery in Web to keep the selected computer,
					agents, and update request.
				</p>
				<Button
					onClick={() =>
						openDesktopWeb(destination).catch((error: Error) =>
							setMessage(error.message)
						)
					}
				>
					{input.sourceNavigationAction
						? "Open request in Web"
						: "Continue in Web"}
				</Button>
				{input.sourceNavigationAction ? (
					<p className="text-muted-foreground text-sm">
						Reopen the original request in its Space to continue that action.
					</p>
				) : null}
				{message ? (
					<p className="text-sm" role="alert">
						{message}
					</p>
				) : null}
			</div>
		);
	}
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
