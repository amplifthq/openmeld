import { createFileRoute } from "@tanstack/react-router";
import { decodeMarkdownUrl } from "@/lib/shared";
import { docsLlms, source } from "@/lib/source";

export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = decodeMarkdownUrl(params._splat?.split("/") ?? []);
        const page = source.getPage(slugs);
        if (!page) {
          return new Response("Page not found", { status: 404 });
        }

        return new Response(await docsLlms.page(page), {
          headers: {
            "Content-Type": "text/markdown",
          },
        });
      },
    },
  },
});
