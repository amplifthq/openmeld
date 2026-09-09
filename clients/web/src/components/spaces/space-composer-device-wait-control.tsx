import { Button } from "@openmeld/ui/components/button";
import {
	createSpaceComposerDeviceWait,
	type SpaceComposerSendOptions,
} from "./space-composer-device-wait";
import type { SpaceComposerAddressingTarget } from "./use-space-mention-authoring";

export function SpaceComposerDeviceWaitControl(input: {
	target: SpaceComposerAddressingTarget;
	disabled: boolean;
	onSubmit: (options: SpaceComposerSendOptions) => void;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 pt-2">
			<p className="min-w-0 flex-1 text-muted-foreground text-xs leading-5">
				{input.target.profileName}’s computer is{" "}
				{input.target.agentWakeAvailability?.reasonCode ===
				"local_service.reconnecting"
					? "reconnecting"
					: "offline"}
				. Send now and it will run when the computer is ready. We’ll wait up to
				24 hours.
			</p>
			<Button
				disabled={input.disabled}
				onClick={() => {
					const deviceWait = createSpaceComposerDeviceWait(input.target);
					if (deviceWait) {
						input.onSubmit({ deviceWait });
					}
				}}
				size="sm"
				type="button"
			>
				Send and wait
			</Button>
		</div>
	);
}
