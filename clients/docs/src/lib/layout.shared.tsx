import { OpenMeldWordmark } from "@openmeld/ui/components/openmeld-wordmark";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { gitConfig } from "./shared";

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
      { text: "Website", url: import.meta.env.VITE_WEBSITE_URL },
      { text: "Open app", url: import.meta.env.VITE_APP_URL },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
