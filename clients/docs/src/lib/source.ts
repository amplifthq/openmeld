import { llms, loader } from "fumadocs-core/source";
import { Rocket } from "lucide-react";
import { createElement } from "react";
import { docs } from "./content";
import { docsRoute } from "./shared";

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
  icon: (name) => (name === "Rocket" ? createElement(Rocket) : undefined),
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`,
});
