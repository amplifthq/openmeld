import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConversationsSidebar } from "../../src/components/spaces/conversations-sidebar";
import "../sidebar-preview/preview.css";

const client = new QueryClient();
function Preview() {
	const [dark, setDark] = useState(false);
	const [width, setWidth] = useState(320);
	return (
		<QueryClientProvider client={client}>
			<TooltipProvider>
				<div className={dark ? "dark" : ""}>
					<main className="min-h-screen bg-background p-4 text-foreground">
						<header className="mb-4 flex flex-wrap items-center gap-4">
							<p>Fictional conversations · Browser preferences only</p>
							<button onClick={() => setDark(!dark)} type="button">
								Switch theme
							</button>
							<label>
								Sidebar width{" "}
								<input
									aria-label="Sidebar width"
									className="w-20 rounded border px-2"
									max={420}
									min={180}
									onChange={(event) => setWidth(Number(event.target.value))}
									type="number"
									value={width}
								/>
							</label>
						</header>
						<div className="flex items-start gap-6">
							<aside
								className="max-w-full shrink-0 rounded-xl bg-sidebar p-2"
								style={{ width }}
							>
								<ConversationsSidebar />
							</aside>
							<section className="hidden min-w-0 flex-1 md:block">
								<h1 className="mb-4 text-xl">Product design</h1>
								<p className="mb-6 text-muted-foreground">
									Switch views while keeping this conversation open.
								</p>
								<textarea
									aria-label="Message draft"
									className="min-h-32 w-full rounded-lg border p-3"
									defaultValue="Keep this unsent draft"
								/>
							</section>
						</div>
					</main>
				</div>
			</TooltipProvider>
		</QueryClientProvider>
	);
}
const route = createRootRoute({ component: Preview });
const router = createRouter({ routeTree: route });
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<RouterProvider router={router} />);
}
