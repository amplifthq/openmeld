import { Button } from "@openmeld/ui/components/button";
import { useSpaceEntryRetry } from "./space-entry-confirmation";

export function SpaceEntryRecoveryNotice() {
	const retry = useSpaceEntryRetry();
	if (!retry) {
		return null;
	}
	return (
		<output className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2 text-muted-foreground text-xs">
			<span>Showing saved messages. OpenMeld couldn't confirm access.</span>
			<Button className="shrink-0" onClick={retry} size="sm" variant="outline">
				Try again
			</Button>
		</output>
	);
}
