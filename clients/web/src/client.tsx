import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { installClientVersionRecovery } from "./client-version-recovery";

installClientVersionRecovery({
	now: Date.now,
	reload: () => {
		window.location.reload();
	},
	window,
});

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<StartClient />
		</StrictMode>
	);
});
