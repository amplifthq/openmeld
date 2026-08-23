"use client";

import { cn } from "@openmeld/ui/lib/utils";
import { XIcon } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { Drawer } from "vaul";
import { AppNavigationPresentationProvider } from "./app-navigation-presentation";

export function AppMobileNavigationDrawer(input: {
	children: ReactNode;
	closeLabel: string;
	description: string;
	hideEmbeddedHeader?: boolean;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: string;
}) {
	return (
		<Drawer.Root
			autoFocus
			direction="left"
			modal
			onOpenChange={input.onOpenChange}
			open={input.open}
		>
			<Drawer.Portal>
				<Drawer.Overlay className="motion-reduce:!transition-none fixed inset-0 z-50 bg-background/60 backdrop-blur-[2px]" />
				<Drawer.Content
					className="motion-reduce:!transition-none fixed inset-y-0 left-0 z-50 flex w-[min(20rem,calc(100vw-1.5rem))] max-w-full overscroll-contain border-border border-r bg-background outline-none"
					style={
						{
							"--initial-transform": "calc(-100% - 1px)",
						} as CSSProperties
					}
				>
					<div className="flex min-h-0 w-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
						<div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-border border-b px-3">
							<Drawer.Title className="truncate font-medium text-sm">
								{input.title}
							</Drawer.Title>
							<Drawer.Close asChild>
								<button
									aria-label={input.closeLabel}
									className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
									type="button"
								>
									<XIcon aria-hidden="true" className="size-5" />
								</button>
							</Drawer.Close>
						</div>
						<Drawer.Description className="sr-only">
							{input.description}
						</Drawer.Description>
						<AppNavigationPresentationProvider
							dismiss={() => input.onOpenChange(false)}
							presentation="drawer"
						>
							<div
								className={cn(
									"[&>[data-slot=sidebar-wrapper]]:!h-full [&>[data-slot=sidebar-wrapper]]:!w-full [&_[data-slot=sidebar]]:!w-full min-h-0 flex-1 [&_[data-slot=sidebar-rail]]:hidden",
									input.hideEmbeddedHeader &&
										"[&_[data-slot=sidebar-header]]:hidden"
								)}
							>
								{input.children}
							</div>
						</AppNavigationPresentationProvider>
					</div>
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
	);
}
