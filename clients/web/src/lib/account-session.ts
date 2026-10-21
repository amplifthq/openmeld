import { readAccountSession } from "@openmeld/api-client";
import { createIsomorphicFn } from "@tanstack/react-start";
import { createUnscopedWebOpenMeldApiFoundation } from "./openmeld-api/client";

export const readCurrentAccountSession = createIsomorphicFn()
	.client((signal?: AbortSignal) =>
		readAccountSession(createUnscopedWebOpenMeldApiFoundation(), { signal })
	)
	.server(async (signal?: AbortSignal) => {
		const { readAccountSessionFromRequest } = await import(
			"./account-session.server"
		);
		return readAccountSessionFromRequest(signal);
	});
