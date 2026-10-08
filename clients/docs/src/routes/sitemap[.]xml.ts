import { createFileRoute } from "@tanstack/react-router";
import { source } from "@/lib/source";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const urls = ["/", ...source.getPages().map((page) => page.url)];
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>https://docs.openmeld.ai${url.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</loc></url>`).join("")}</urlset>`,
          { headers: { "Content-Type": "application/xml; charset=utf-8" } }
        );
      },
    },
  },
});
