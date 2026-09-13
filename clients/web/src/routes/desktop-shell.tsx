import { createFileRoute } from "@tanstack/react-router";

// A loader-free document for the local Desktop SPA build. Business routes
// load their normal data only after the native authenticated transport exists.
export const Route = createFileRoute("/desktop-shell")({
	component: () => null,
});
