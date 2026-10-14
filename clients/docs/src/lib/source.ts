import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { llms, loader } from "fumadocs-core/source";
import { Rocket } from "lucide-react";
import { createElement } from "react";
import { docs } from "./content";
import { docsRoute } from "./shared";

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
  pageTree: {
    transformers: [
      {
        folder(node, path) {
          if (path !== "local-agents") {
            return node;
          }
          return {
            ...node,
            name: createElement(
              "span",
              { className: "inline-flex min-w-0 items-center gap-2" },
              node.name,
              createElement(
                "span",
                { "aria-hidden": true, className: "docs-local-agent-stack" },
                node.children
                  .flatMap((child) =>
                    child.type === "folder" ? child.children : [child]
                  )
                  .filter((child) => child.icon)
                  .map((child) =>
                    createElement("span", { key: child.$id }, child.icon)
                  )
              )
            ),
          };
        },
      },
    ],
  },
  icon: (name) => {
    if (name?.startsWith("local-agent:")) {
      return createElement(LocalAgentLogo, {
        agentId: name.slice("local-agent:".length),
        variant: "plain",
        size: "sm",
      });
    }
    return name === "Rocket" ? createElement(Rocket) : undefined;
  },
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`,
});
