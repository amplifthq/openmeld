import type { ConnectorConnection } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { CheckIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";

export type PluginDetailLayout = (
	action: ReactNode,
	content: ReactNode
) => ReactNode;

/** Presentation only. Provider owners supply the current snapshot and mutations. */
export function PluginDetailConnection(input: {
	appName: string;
	connection?: ConnectorConnection;
	loading: boolean;
	unavailable: boolean;
	disabled: boolean;
	canManage: boolean;
	canConnect: boolean;
	connecting: boolean;
	disconnecting: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
	renderDetail: PluginDetailLayout;
	children?: ReactNode;
	errorMessage?: string | null;
	disconnectDescription?: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const reconnect = input.connection?.health?.state === "reconnect_required";
	const label = connectionActionLabel(input);
	const action = input.loading ? (
		<Skeleton aria-label="Loading connection status" className="h-8 w-24" />
	) : (
		<Button
			disabled={
				input.disabled ||
				input.unavailable ||
				!(input.connection || (input.canManage && input.canConnect))
			}
			onClick={() => (input.connection ? setOpen(true) : input.onConnect())}
			size="sm"
			variant="outline"
		>
			{input.connection && !reconnect ? <CheckIcon aria-hidden="true" /> : null}
			{label}
		</Button>
	);
	return (
		<>
			{input.renderDetail(action, input.children)}
			<Dialog
				onOpenChange={(next) => {
					if (!input.disconnecting) {
						setOpen(next);
					}
				}}
				open={open}
			>
				<DialogContent showCloseButton={!input.disconnecting}>
					<DialogHeader>
						<DialogTitle>{input.appName} connection</DialogTitle>
						<DialogDescription>
							{connectionDescription(input)}
						</DialogDescription>
					</DialogHeader>
					{input.errorMessage ? (
						<p className="text-destructive text-sm" role="alert">
							{input.errorMessage}
						</p>
					) : null}
					{reconnect ? (
						<p className="text-muted-foreground text-sm">
							Reconnect this account to restore access.
						</p>
					) : null}
					{input.connection ? (
						<p className="text-muted-foreground text-sm">
							{input.disconnectDescription ??
								`Disconnecting removes this account’s access in OpenMeld. It does not delete data in ${input.appName}.`}
						</p>
					) : null}
					<DialogFooter>
						<Button
							disabled={input.disconnecting}
							onClick={() => setOpen(false)}
							size="sm"
							variant="outline"
						>
							{input.connection || input.disconnecting ? "Cancel" : "Done"}
						</Button>
						{input.connection &&
						input.canManage &&
						input.connection.canDisconnect ? (
							<Button
								disabled={input.disabled}
								onClick={input.onDisconnect}
								size="sm"
								variant="destructive"
							>
								{input.disconnecting ? "Disconnecting…" : "Disconnect"}
							</Button>
						) : null}
						{reconnect && input.canManage && input.canConnect ? (
							<Button
								disabled={input.disabled}
								onClick={() => {
									setOpen(false);
									input.onConnect();
								}}
								size="sm"
							>
								Reconnect
							</Button>
						) : null}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function connectionDescription(
	input: Parameters<typeof PluginDetailConnection>[0]
): string {
	if (input.disconnecting) {
		return "Disconnecting this account…";
	}
	if (!input.connection) {
		return "This account has been disconnected.";
	}
	return `Authorized by ${input.connection.ownerDisplayName}.`;
}

function connectionActionLabel(
	input: Parameters<typeof PluginDetailConnection>[0]
): string {
	if (input.disconnecting) {
		return "Disconnecting…";
	}
	if (input.connecting) {
		return "Connecting…";
	}
	if (input.unavailable) {
		return "Unavailable";
	}
	if (input.connection?.health?.state === "reconnect_required") {
		return "Reconnect";
	}
	return input.connection ? "Connected" : "Connect";
}
