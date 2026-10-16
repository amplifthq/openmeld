import { OpenAppButton } from "@openmeld/ui/components/open-app-button";
import { Link } from "@tanstack/react-router";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import type { ComponentProps } from "react";

function DocsBrand({ className, href, ...props }: ComponentProps<"a">) {
  return (
    <div className={className}>
      <a {...props} aria-label="OpenMeld home" href={href}>
        {/* biome-ignore lint/performance/noImgElement: Static public brand asset in TanStack Start. */}
        <img
          alt="OpenMeld"
          className="block h-auto w-36 dark:hidden"
          height={560}
          src="/brand/openmeld-wordmark-ink-2400.png"
          width={2400}
        />
        {/* biome-ignore lint/performance/noImgElement: Static public brand asset in TanStack Start. */}
        <img
          alt="OpenMeld"
          className="hidden h-auto w-36 dark:block"
          height={560}
          src="/brand/openmeld-wordmark-glow-2400.png"
          width={2400}
        />
      </a>
      <Link
        className="text-fd-muted-foreground hover:text-fd-foreground"
        to="/"
      >
        Docs
      </Link>
    </div>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: DocsBrand,
      url: import.meta.env.VITE_WEBSITE_URL,
    },
    links: [
      {
        type: "custom",
        children: (
          <OpenAppButton
            className="docs-open-app mb-2 w-full"
            href={import.meta.env.VITE_APP_URL}
            size="compact"
          />
        ),
      },
      { text: "Guides", url: "/docs" },
      { text: "Downloads", url: "/docs/start/downloads" },
      {
        text: "Changelog",
        url: `${import.meta.env.VITE_WEBSITE_URL}/changelog`,
      },
    ],
  };
}
