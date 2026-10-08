import { FAVICON_ICO_URL } from "@openmeld/ui/lib/favicon";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

declare const __OPENMELD_DOCS_BUILD__: {
  id: string;
  sha: string;
  dirty: boolean;
};

import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "OpenMeld Docs",
      },
      {
        name: "description",
        content:
          "Learn how to work with AI teammates in OpenMeld. Get started, connect your tools, share work, and find help.",
      },
      {
        name: "robots",
        content: import.meta.env.VITE_DOCS_INDEXABLE
          ? "index, follow"
          : "noindex, nofollow",
      },
      { name: "openmeld-source-sha", content: __OPENMELD_DOCS_BUILD__.sha },
      { name: "openmeld-build-id", content: __OPENMELD_DOCS_BUILD__.id },
      {
        name: "openmeld-build-dirty",
        content: String(__OPENMELD_DOCS_BUILD__.dirty),
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: FAVICON_ICO_URL },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html className="font-geist-vars" lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        <RootProvider>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
