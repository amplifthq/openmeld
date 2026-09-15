import { readAccountSession } from "@openmeld/api-client";
import { createIsomorphicFn } from "@tanstack/react-start";
import { createUnscopedWebOpenMeldApiFoundation } from "./openmeld-api/client";

export const readCurrentAccountSession = createIsomorphicFn()
	.client(() => readAccountSession(createUnscopedWebOpenMeldApiFoundation()))
	.server(async () => {
		const { readAccountSessionFromRequest } = await import(
			"./account-session.server"
		);
		return readAccountSessionFromRequest();
	});
