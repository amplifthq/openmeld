import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { createRoot } from "react-dom/client";
import { KeyProjectsPreview } from "./key-projects";
import "./preview.css";
createRoot(document.getElementById("root") as HTMLElement).render(
	<TooltipProvider>
		<KeyProjectsPreview />
	</TooltipProvider>
);
