import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { installClientVersionRecovery } from "./client-version-recovery";
import {
	installApplicationErrorReporting,
	reportClientApplicationError,
} from "./lib/observability/application-error-client";

installApplicationErrorReporting();

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
		</StrictMode>,
		{
			onCaughtError: (error) =>
				reportClientApplicationError(error, "react_caught"),
			onUncaughtError: (error) =>
				reportClientApplicationError(error, "react_uncaught"),
			onRecoverableError: (error) =>
				reportClientApplicationError(error, "react_recoverable"),
		}
	);
});
