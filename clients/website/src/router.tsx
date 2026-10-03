import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	return createRouter({ routeTree, scrollRestoration: true });
}

declare module "@tanstack/react-router" {
	// biome-ignore lint/style/useConsistentTypeDefinitions: TanStack Router requires declaration merging.
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
