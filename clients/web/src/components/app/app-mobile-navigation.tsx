"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@openmeld/ui/components/sheet";
import { cn } from "@openmeld/ui/lib/utils";
import { XIcon } from "@phosphor-icons/react";
import type { ReactNode, RefObject } from "react";
import { AppNavigationPresentationProvider } from "./app-navigation-presentation";

export function AppMobileNavigationDrawer(input: {
	children: ReactNode;
	closeLabel: string;
	description: string;
	hideEmbeddedHeader?: boolean;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	returnFocusRef: RefObject<HTMLButtonElement | null>;
	side: "left" | "right";
	title: string;
}) {
	return (
		<Sheet modal onOpenChange={input.onOpenChange} open={input.open}>
			<SheetContent
				className="w-[min(20rem,calc(100vw-1.5rem))] max-w-full gap-0 overscroll-contain bg-background p-0 text-foreground sm:max-w-none"
				finalFocus={input.returnFocusRef}
				showCloseButton={false}
				side={input.side}
			>
				<div className="flex min-h-0 w-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
					<div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-border border-b px-3">
						<SheetTitle className="truncate">{input.title}</SheetTitle>
						<SheetClose
							render={
								<Button
									aria-label={input.closeLabel}
									className="shrink-0 text-muted-foreground hover:text-foreground"
									size="icon"
									variant="ghost"
								/>
							}
						>
							<XIcon aria-hidden="true" className="size-5" />
						</SheetClose>
					</div>
					<SheetDescription className="sr-only">
						{input.description}
					</SheetDescription>
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
			</SheetContent>
		</Sheet>
	);
}
