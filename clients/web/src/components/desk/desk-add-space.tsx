import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { buildOrganizationNewSpacePath } from "#/lib/organizations/organization-routes";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";

export function DeskAddSpace(input: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	spaces: readonly AccountSpaceItem[];
	shownIds: readonly string[];
	orgSlug: string;
	loading: boolean;
	error: boolean;
	onRetry: () => void;
	onAdd: (item: AccountSpaceItem) => void;
}) {
	const [query, setQuery] = useState("");
	const items = input.spaces.filter((item) =>
		item.spaceName
			.toLocaleLowerCase()
			.includes(query.trim().toLocaleLowerCase())
	);
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add Space</DialogTitle>
				</DialogHeader>
				<Input
					aria-label="Search Spaces"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search Spaces"
					value={query}
				/>
				<div className="grid max-h-80 gap-1 overflow-y-auto">
					{input.loading && <output>Loading Spaces…</output>}
					{input.error && (
						<div role="alert">
							Couldn’t load Spaces.{" "}
							<Button onClick={input.onRetry} variant="outline">
								Try again
							</Button>
						</div>
					)}
					{!(input.loading || input.error) && items.length === 0 && (
						<p className="py-6 text-center text-muted-foreground text-sm">
							{query ? "No matching Spaces." : "No Spaces yet."}
						</p>
					)}
					{items.map((item) => (
						<Button
							className="h-auto justify-between py-3 text-left"
							disabled={input.shownIds.includes(item.spaceId)}
							key={item.spaceId}
							onClick={() => input.onAdd(item)}
							variant="ghost"
						>
							<span className="truncate">{item.spaceName}</span>
							<span className="shrink-0 text-muted-foreground text-xs">
								{input.shownIds.includes(item.spaceId) ? "On Desk" : "Add"}
							</span>
						</Button>
					))}
				</div>
				<Link
					className={buttonVariants({ variant: "outline" })}
					to={buildOrganizationNewSpacePath(input.orgSlug)}
				>
					Create Space
				</Link>
			</DialogContent>
		</Dialog>
	);
}
