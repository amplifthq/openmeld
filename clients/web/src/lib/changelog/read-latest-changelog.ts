import { createServerFn } from "@tanstack/react-start";

export const readLatestChangelog = createServerFn({ method: "GET" }).handler(
	async () => {
		const { readProductionChangelog } = await import(
			"./read-latest-changelog.server"
		);
		return readProductionChangelog();
	}
);
