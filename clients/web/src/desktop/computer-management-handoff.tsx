import { Button } from "@openmeld/ui/components/button";
import { useState } from "react";
import { canConfigureLocalComputer, openDesktopWeb } from "./platform";

export function ComputerManagementHandoff() {
	const [error, setError] = useState<string | null>(null);
	if (canConfigureLocalComputer()) {
		return null;
	}
	return (
		<div className="space-y-2">
			<p className="text-muted-foreground text-sm">
				Use OpenMeld Web to set up this computer, update tools, or change local
				settings.
			</p>
			<Button
				onClick={() => {
					openDesktopWeb(
						window.location.pathname + window.location.search
					).catch((cause: unknown) =>
						setError(
							cause instanceof Error
								? cause.message
								: "Could not open Web. Try again."
						)
					);
				}}
				size="sm"
				variant="outline"
			>
				Open in Web
			</Button>
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}
