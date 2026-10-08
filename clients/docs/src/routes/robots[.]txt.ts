import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          import.meta.env.VITE_DOCS_INDEXABLE
            ? "User-agent: *\nAllow: /\nSitemap: https://docs.openmeld.ai/sitemap.xml\n"
            : "User-agent: *\nDisallow: /\n",
          { headers: { "Content-Type": "text/plain; charset=utf-8" } }
        ),
    },
  },
});
