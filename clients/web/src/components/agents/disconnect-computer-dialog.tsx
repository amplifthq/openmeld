import type { DesktopComputerDisconnectRequest } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { toast } from "sonner";
import { useAuthSession } from "#/hooks/auth.hooks";
import { formatWebCliCommand } from "#/lib/cli-entry-command";
import { copyTextToClipboard } from "#/lib/clipboard";

const SAFE_COMMAND_ID = /^[A-Za-z0-9_-]+$/u;

export function DisconnectComputerDialog(input: {
	computerName: string;
	target: NonNullable<DesktopComputerDisconnectRequest["expectedConnection"]>;
	onClose: () => void;
}) {
	const account = useAuthSession().data?.user.id;
	// These IDs are shell arguments on both POSIX and PowerShell. Refuse unusual
	// values instead of generating a command with ambiguous shell escaping.
	const values = [account, input.target.deviceId, input.target.runtimeLane];
	const command = values.every((value) => value && SAFE_COMMAND_ID.test(value))
		? formatWebCliCommand(
				`openmeld computer disconnect --expected-account ${account} --device ${input.target.deviceId} --runtime-lane ${input.target.runtimeLane}`,
				{ runtimeLane: input.target.runtimeLane }
			)
		: null;
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					input.onClose();
				}
			}}
			open
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Disconnect {input.computerName}</DialogTitle>
					<DialogDescription>
						Run this command in a terminal on {input.computerName}. OpenMeld
						waits for active work to finish, stops its Service, and signs out
						the local CLI. The Computer stays in your account. Your browser and
						Desktop stay signed in.
					</DialogDescription>
				</DialogHeader>
				{command ? (
					<>
						<pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
							<code>{command}</code>
						</pre>
						<Button
							onClick={async () => {
								if (await copyTextToClipboard(command)) {
									toast.success("Command copied.");
								} else {
									toast.error(
										"Could not copy. Select and copy the command above."
									);
								}
							}}
						>
							Copy command
						</Button>
					</>
				) : (
					<p className="text-sm">
						Refresh this page to load the account and Computer details.
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
