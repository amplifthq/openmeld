import { Button } from "@openmeld/ui/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { getBridge } from "../../../desktop/src/renderer/ipc";
import { getDesktopPlatform } from "./platform";

function serviceStatusText(
	pending: "start" | "stop" | null,
	loading: boolean,
	lifecycle?: string
) {
	if (pending === "stop") {
		return "Stopping after current work finishes…";
	}
	if (pending === "start") {
		return "Starting…";
	}
	if (loading) {
		return "Checking Service…";
	}
	if (lifecycle === "running") {
		return "Running";
	}
	if (lifecycle === "stopped") {
		return "Stopped";
	}
	return "Service status is unavailable.";
}

export function DesktopServiceControls({ deviceId }: { deviceId: string }) {
	return getDesktopPlatform() ? (
		<LocalServiceControls deviceId={deviceId} />
	) : null;
}

function LocalServiceControls({ deviceId }: { deviceId: string }) {
	const { currentUserId } = useAppOrganization();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState<"start" | "stop" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const queryKey = ["desktop-service-control", currentUserId];
	const query = useQuery({
		queryKey,
		queryFn: async () => {
			const bridge = getBridge();
			const [service, auth] = await Promise.all([
				bridge.getServiceStatus(),
				bridge.getAuthStatus(),
			]);
			return { service, auth };
		},
		refetchInterval: 5000,
	});
	const service = query.data?.service;
	const capabilities = service?.controlCapabilities;
	if (capabilities?.deviceId !== deviceId) {
		return null;
	}
	const auth = query.data?.auth;
	const matches =
		auth?.signedIn === true &&
		!auth.problem &&
		auth.accountId === currentUserId;
	const differentAccount =
		auth?.signedIn === true &&
		!auth.problem &&
		Boolean(auth.accountId) &&
		auth.accountId !== currentUserId;
	async function run(operation: "start" | "stop") {
		// Capture the account the person is looking at, never substitute a later session.
		const expectedAccount = currentUserId;
		setPending(operation);
		setError(null);
		try {
			const bridge = getBridge();
			const result = await (operation === "start"
				? bridge.startService(expectedAccount)
				: bridge.stopService(expectedAccount));
			if (result.problem) {
				setError(result.problem.message);
			}
			await queryClient.invalidateQueries({ queryKey });
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Check Service status and try again."
			);
		} finally {
			setPending(null);
		}
	}
	return (
		<details className="order-last space-y-2 border-t pt-3">
			<summary className="cursor-pointer text-muted-foreground text-sm">
				Background service controls
			</summary>
			<output className="block text-muted-foreground text-sm">
				{serviceStatusText(pending, query.isPending, service?.lifecycle)}
			</output>
			{differentAccount ? (
				<p className="text-muted-foreground text-sm">
					This computer is connected to another account. Use Connect this
					computer to review an account switch.
				</p>
			) : null}
			{auth?.signedIn === false && !auth.problem ? (
				<p className="text-muted-foreground text-sm">
					This computer is not signed in. Connect this computer to continue.
				</p>
			) : null}
			{auth &&
			(auth.problem ||
				auth.signedIn === null ||
				(auth.signedIn && !auth.accountId)) ? (
				<p className="text-muted-foreground text-sm">
					The account for this computer could not be checked. Check status to
					try again.
				</p>
			) : null}
			{query.data && !(capabilities?.start || capabilities?.stop) ? (
				<p className="text-muted-foreground text-sm">
					Local controls are unavailable. Check status to try again.
				</p>
			) : null}
			{error || query.error ? (
				<p className="text-destructive text-sm" role="alert">
					{error ?? query.error?.message}
				</p>
			) : null}
			<div className="flex gap-2">
				{capabilities?.start ? (
					<Button
						disabled={!matches || pending !== null}
						onClick={() => run("start")}
						size="sm"
						variant="outline"
					>
						Start Service
					</Button>
				) : null}
				{capabilities?.stop ? (
					<Button
						disabled={!matches || pending !== null}
						onClick={() => run("stop")}
						size="sm"
						variant="outline"
					>
						Stop Service
					</Button>
				) : null}
				<Button
					disabled={query.isFetching}
					onClick={() => query.refetch()}
					size="sm"
					variant="ghost"
				>
					Check status
				</Button>
			</div>
		</details>
	);
}
