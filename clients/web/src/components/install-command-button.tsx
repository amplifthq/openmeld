"use client";

import { Button } from "@openmeld/ui/components/button";
import { useCallback, useEffect, useState } from "react";
import {
	copyCliEntryCommand,
	resolveWebStartCommand,
} from "#/lib/cli-entry-command";
import { WaitlistSignupForm } from "./waitlist-signup-form";

const COPY_LABEL = "Copy";
const COPIED_LABEL = "Copied";

export function InstallCommandButton() {
	const [copied, setCopied] = useState(false);
	const installCommand = resolveWebStartCommand();

	const handleCopy = useCallback(async () => {
		const didCopy = await copyCliEntryCommand(installCommand);
		if (didCopy) {
			setCopied(true);
		} else {
			setCopied(false);
		}
	}, [installCommand]);

	useEffect(() => {
		if (!copied) {
			return;
		}

		const timer = window.setTimeout(() => {
			setCopied(false);
		}, 1500);

		return () => window.clearTimeout(timer);
	}, [copied]);

	return (
		<div className="mt-16 flex flex-col items-center gap-2">
			<div className="relative inline-flex">
				<Button
					aria-label={`Copy command: ${installCommand}`}
					className="h-10 justify-start px-3 pr-20 font-mono text-xs sm:text-sm"
					onClick={handleCopy}
					type="button"
					variant="outline"
				>
					{installCommand}
				</Button>

				<Button
					className="absolute top-1/2 right-1 -translate-y-1/2 font-mono"
					onClick={handleCopy}
					size="xs"
					type="button"
					variant="secondary"
				>
					{copied ? COPIED_LABEL : COPY_LABEL}
				</Button>
			</div>
			<p className="text-center text-muted-foreground text-xs">
				⚠️ We are in a pre-release phase and everything is subject to change. Run
				this command in your terminal with caution. ⚠️
			</p>
			<WaitlistSignupForm />
		</div>
	);
}
