import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { ChatCircleTextIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { type MouseEvent, useEffect } from "react";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import {
	spaceCreationKey,
	spaceCreationPath,
	useSpaceCreations,
} from "#/query/spaces/space-creation";

export function SpaceCreationSidebar(input: {
	organizationId: string;
	orgSlug: string;
	profileId: string | undefined;
	spaceIds: readonly string[];
	onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
	const profileId = input.profileId ?? "";
	const creations = useSpaceCreations(input.organizationId, profileId);
	const client = useQueryClient();
	useEffect(() => {
		const cache = client.getMutationCache();
		for (const creation of creations) {
			if (
				creation.status !== "success" ||
				!creation.response ||
				!input.spaceIds.includes(creation.response.spaceId)
			) {
				continue;
			}
			const mutation = cache
				.findAll({
					mutationKey: spaceCreationKey(input.organizationId, profileId),
					exact: true,
				})
				.find((item) => item.mutationId === creation.id);
			if (mutation) {
				cache.remove(mutation);
			}
		}
	}, [client, creations, input.organizationId, input.spaceIds, profileId]);
	const pathname = useLocation({ select: (location) => location.pathname });
	const visible = creations.filter(
		(creation) =>
			creation.status === "pending" ||
			(creation.status === "success" &&
				creation.response &&
				!input.spaceIds.includes(creation.response.spaceId))
	);
	if (visible.length === 0) {
		return null;
	}
	return (
		<FluidNavMenu
			activeValue={visible.reduce<string | null>((active, creation) => {
				const spaceId =
					creation.response?.spaceId ?? creation.input?.creationId;
				return spaceId &&
					pathname ===
						buildOrganizationSpacePath({ orgSlug: input.orgSlug, spaceId })
					? String(creation.id)
					: active;
			}, null)}
			aria-label="New Spaces"
			className="mb-2"
		>
			{visible.map((creation, index) => (
				<FluidNavMenuItem
					index={index}
					key={creation.id}
					value={String(creation.id)}
				>
					<Link
						aria-label={
							creation.status === "pending"
								? `${creation.input?.name}, Creating…`
								: creation.input?.name
						}
						className="flex min-h-12 items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
						onClick={input.onNavigate}
						to={
							creation.response
								? buildOrganizationSpacePath({
										orgSlug: input.orgSlug,
										spaceId: creation.response.spaceId,
										search: { profileId },
									})
								: spaceCreationPath(
										input.orgSlug,
										profileId,
										creation.input?.creationId ?? ""
									)
						}
					>
						<ChatCircleTextIcon
							aria-hidden="true"
							className="size-6 shrink-0 text-muted-foreground"
						/>
						<span className="min-w-0 flex-1 truncate">
							{creation.input?.name}
						</span>
						{creation.status === "pending" ? (
							<span className="shrink-0 text-muted-foreground text-xs">
								Creating…
							</span>
						) : null}
					</Link>
				</FluidNavMenuItem>
			))}
		</FluidNavMenu>
	);
}
