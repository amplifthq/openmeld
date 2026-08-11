import { lazy, Suspense } from "react";
import { isDevtoolsEnabled } from "./devtools-policy";

const AppDevtools = import.meta.env.DEV
	? lazy(async () => await import("./app-devtools"))
	: null;

export function TanStackDevtoolsSlot() {
	if (!(AppDevtools && isDevtoolsEnabled())) {
		return null;
	}

	return (
		<Suspense fallback={null}>
			<AppDevtools />
		</Suspense>
	);
}
