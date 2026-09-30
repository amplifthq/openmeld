import {
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { ArrowSquareOutIcon, LinkIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { copyAppLinkWithFeedback } from "#/lib/copy-app-link";

export function ObjectMenuItems(input: { href?: string; onOpen?: () => void }) {
	const navigate = useNavigate();
	const href = input.href;
	const open =
		input.onOpen ??
		(() => {
			if (!href) {
				return;
			}
			const destination = new URL(href, window.location.origin);
			navigate({
				to: destination.pathname,
				search: Object.fromEntries(destination.searchParams),
				hash: destination.hash.slice(1),
			}).catch(() => toast.error("Couldn't open this page. Try again."));
		});
	return (
		<FluidDropdownMenuGroup>
			<FluidDropdownMenuItem index={-2} onClick={open}>
				<ArrowSquareOutIcon aria-hidden="true" />
				Open
			</FluidDropdownMenuItem>
			{href && (
				<FluidDropdownMenuItem
					index={-1}
					onClick={() => copyAppLinkWithFeedback(href)}
				>
					<LinkIcon aria-hidden="true" />
					Copy link
				</FluidDropdownMenuItem>
			)}
		</FluidDropdownMenuGroup>
	);
}
