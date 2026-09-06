import defaults from "../../../scripts/sidebar-preview/runtime-states.local.json";

// Generated per worktree; never import local fixture data into a production build.
const generated = import.meta.env.DEV
	? import.meta.glob<typeof defaults>(
			"../../../scripts/sidebar-preview/runtime-states.generated.json",
			{ eager: true, import: "default" }
		)
	: {};

export const manifest = Object.values(generated)[0] ?? defaults;

export function currentFixtureManifest() {
	const data = manifest as typeof manifest & {
		organizations?: (typeof manifest)[];
	};
	return (
		data.organizations?.find(
			(item) =>
				typeof window !== "undefined" &&
				window.location.pathname.startsWith(`/o/${item.organizationSlug}/`)
		) ?? manifest
	);
}

export function isLocalFixtureHost() {
	return (
		typeof window !== "undefined" &&
		(["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) ||
			window.location.hostname.endsWith(".localhost"))
	);
}
