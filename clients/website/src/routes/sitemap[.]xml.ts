import { createFileRoute } from "@tanstack/react-router";

// Only canonical public pages belong here. Downloads with query parameters,
// embedded demos, and App protocols are not separate search landing pages.
const paths = ["/", "/downloads", "/changelog", "/privacy", "/terms"];

export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: () =>
				new Response(
					`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>https://openmeld.ai${path}</loc></url>`).join("")}</urlset>`,
					{ headers: { "Content-Type": "application/xml; charset=utf-8" } }
				),
		},
	},
});
