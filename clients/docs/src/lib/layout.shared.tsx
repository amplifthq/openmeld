import { OpenAppButton } from "@openmeld/ui/components/open-app-button";
import { OpenMeldWordmark } from "@openmeld/ui/components/openmeld-wordmark";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <OpenMeldWordmark />
          <span className="text-fd-muted-foreground">Docs</span>
        </>
      ),
    },
    links: [
      { text: "Guides", url: "/docs" },
      { text: "Downloads", url: "/docs/start/downloads" },
      {
        text: "Changelog",
        url: `${import.meta.env.VITE_WEBSITE_URL}/changelog`,
      },
      {
        type: "custom",
        children: (
          <OpenAppButton href={import.meta.env.VITE_APP_URL} size="compact" />
        ),
      },
    ],
  };
}
