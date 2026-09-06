import { Button } from "@openmeld/ui/components/button";
import { useSpaceEntryRetry } from "./space-entry-confirmation";

export function SpaceEntryRecoveryNotice() {
	const recovery = useSpaceEntryRetry();
	if (!recovery) {
		return null;
	}
	return (
		<output className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2 text-muted-foreground text-xs">
			<span>
				{recovery.isError
					? "Showing saved messages. OpenMeld couldn't confirm access."
					: "Checking access before you can send. Your draft stays here."}
			</span>
			<Button
				className="shrink-0"
				onClick={recovery.retry}
				size="sm"
				variant="outline"
			>
				{recovery.isError ? "Try again" : "Check again"}
			</Button>
		</output>
	);
}
