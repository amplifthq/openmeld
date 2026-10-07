import { Dialog } from "@openmeld/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { SettingsDialogContent } from "@openmeld/ui/components/settings-dialog-content";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { ArrowClockwiseIcon, PaletteIcon } from "@phosphor-icons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME,
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { AppSettingsMenuItem } from "#/components/app/app-settings-menu-item";
import {
	DESKTOP_UPDATE_ATTENTION_LABEL,
	DesktopUpdateIndicator,
	DesktopUpdater,
	DesktopUpdatesSection,
	useDesktopUpdateAttention,
	useDesktopUpdater,
} from "#/desktop/updater";
import { actions, cases, emit } from "./bridge";
import "./styles.css";

const parameters = new URLSearchParams(location.search);
document.documentElement.classList.toggle(
	"dark",
	parameters.get("theme") === "dark"
);
document.body.className = "font-geist-vars bg-background text-foreground";

function Fixture() {
	const mode = parameters.get("mode") ?? "settings";
	const [open, setOpen] = useState(mode === "dialog");
	const [section, setSection] = useState("updates");
	const attention = useDesktopUpdateAttention();
	const updater = useDesktopUpdater();
	// Real navigation primitive, selection background, and update accessory.
	// SettingsInnerSidebar's product wiring is exercised in updater.test.tsx.
	const navigation = (
		<div className="space-y-2 text-sidebar-foreground">
			<p className="px-1 text-muted-foreground text-xs">Personal</p>
			<FluidNavMenu
				activeValue={section}
				aria-label="Simulated settings navigation"
			>
				{[
					{ id: "appearance", label: "Appearance", Icon: PaletteIcon },
					{ id: "updates", label: "Updates", Icon: ArrowClockwiseIcon },
				].map(({ id, label, Icon }, index) => (
					<FluidNavMenuItem index={index} key={id} value={id}>
						<button
							aria-current={section === id ? "page" : undefined}
							aria-label={
								id === "updates" && attention
									? `Updates, ${DESKTOP_UPDATE_ATTENTION_LABEL}`
									: label
							}
							className="block w-full min-w-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
							onClick={() => setSection(id)}
							type="button"
						>
							<span
								className={`flex min-w-0 items-center border border-transparent ${APP_NAV_ITEM_FULL_DENSITY_CLASS_NAME} ${APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME} ${APP_NAV_ITEM_TONE_CLASS_NAME}`}
							>
								<Icon className="size-4 shrink-0" />
								<span className="min-w-0 flex-1">{label}</span>
								{id === "updates" && attention ? (
									<DesktopUpdateIndicator />
								) : null}
							</span>
						</button>
					</FluidNavMenuItem>
				))}
			</FluidNavMenu>
		</div>
	);
	const content =
		section === "updates" ? (
			<DesktopUpdatesSection presentation="settings" />
		) : (
			<h1>Appearance</h1>
		);
	return (
		<>
			<DesktopUpdater />
			<div className="flex items-center gap-4 border-border border-b px-6 py-3">
				<DropdownMenu>
					<DropdownMenuTrigger>Account</DropdownMenuTrigger>
					<FluidDropdownMenuContent>
						<AppSettingsMenuItem index={0} onClick={() => setOpen(true)} />
					</FluidDropdownMenuContent>
				</DropdownMenu>
				<p
					className="text-muted-foreground text-xs"
					data-fixture-status={updater?.status ?? "unknown"}
				>
					Simulated updater bridge · {parameters.get("state") ?? "available"} ·
					No downloads or installs
				</p>
			</div>
			{mode === "settings" ? (
				<main className="mx-auto flex max-w-5xl gap-6 p-6">
					<aside className="w-44 shrink-0 max-sm:hidden">{navigation}</aside>
					<div className="min-w-0 flex-1" data-testid="settings-content">
						{content}
					</div>
				</main>
			) : (
				<main className="p-6">
					<label className="flex max-w-sm flex-col gap-2 text-sm">
						Conversation draft
						<input
							className="rounded-md border p-2"
							placeholder="Keep typing without interruption"
						/>
					</label>
				</main>
			)}
			<Dialog onOpenChange={setOpen} open={open}>
				<SettingsDialogContent
					description="Synthetic updater visual acceptance"
					navigation={navigation}
					spacious
					title="App settings"
				>
					{content}
				</SettingsDialogContent>
			</Dialog>
		</>
	);
}

const root = document.getElementById("root");
if (!root) {
	throw new Error("Missing fixture root.");
}
const rootRoute = createRootRoute({ component: Fixture });
const router = createRouter({
	routeTree: rootRoute,
	history: createMemoryHistory({ initialEntries: ["/"] }),
});
const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
Object.assign(window, { updaterFixture: { actions, cases, emit } });
createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>
);
