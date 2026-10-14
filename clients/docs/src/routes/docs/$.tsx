import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { Suspense, use } from "react";
import { useMDXComponents } from "@/components/mdx";
import { docs } from "@/lib/content";
import { baseOptions } from "@/lib/layout.shared";
import { getPageMarkdownUrl } from "@/lib/shared";
import { source } from "@/lib/source";

export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const data = await serverLoader({ data: slugs });
    await docs.getPage(data.path)?.preload();
    return data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Guides"} | OpenMeld Docs` },
      {
        name: "description",
        content: loaderData?.description ?? "OpenMeld guides and help.",
      },
      {
        property: "og:title",
        content: `${loaderData?.title ?? "Guides"} | OpenMeld Docs`,
      },
      {
        property: "og:description",
        content: loaderData?.description ?? "OpenMeld guides and help.",
      },
      { property: "og:type", content: "article" },
    ],
    links: loaderData
      ? [
          {
            rel: "canonical",
            href: `https://docs.openmeld.ai${loaderData.url}`,
          },
        ]
      : [],
  }),
});

const serverLoader = createServerFn({
  method: "GET",
})
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) {
      throw notFound();
    }

    return {
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      path: page.path,
      markdownUrl: getPageMarkdownUrl(page).url,
      pageTree: await source.serializePageTree(source.getPageTree()),
    };
  });

function Content({ path, markdownUrl }: { path: string; markdownUrl: string }) {
  const page = docs.getPage(path);
  if (!page) {
    throw new Error(`unknown page: ${path}`);
  }

  const { toc } = use(page.load());
  const MDX = page.body;

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <div className="-mt-4 flex flex-row items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover markdownUrl={markdownUrl} />
      </div>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function Page() {
  const { path, pageTree, markdownUrl } = useFumadocsLoader(
    Route.useLoaderData()
  );

  return (
    <DocsLayout
      {...baseOptions()}
      sidebar={{
        footer: <ThemeSwitch className="self-start rounded-lg *:rounded-md" />,
      }}
      themeSwitch={{ enabled: false }}
      tree={pageTree}
    >
      <Suspense>
        <Content markdownUrl={markdownUrl} path={path} />
      </Suspense>
    </DocsLayout>
  );
}
