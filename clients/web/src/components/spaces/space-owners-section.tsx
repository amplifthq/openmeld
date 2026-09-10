import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { spaceMembersQueryOptions } from "#/query/spaces/members";
import { spaceQueryKeys, spaceStatusQueryOptions } from "#/query/spaces/status";

function describeSpaceMemberRole(
	userId: string | null | undefined,
	owners: readonly string[],
	internalUserIds: ReadonlySet<string>,
	directoryReady: boolean
) {
	if (userId && owners.includes(userId)) {
		return "Owner";
	}
	if (directoryReady && userId && !internalUserIds.has(userId)) {
		return "Guest";
	}
	return "Member";
}

export function SpaceOwnersSection(input: {
	spaceId: string;
	canManage: boolean;
	openMeldProfileId?: string;
}) {
	const organization = useOptionalAppOrganization()?.currentOrganization;
	const directory = useQuery(
		organizationDirectoryQueryOptions({
			organizationId: organization?.id ?? "",
			enabled: Boolean(organization),
		})
	);
	const internalUserIds = new Set(
		directory.data?.members.map((member) => member.userId)
	);
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const client = useQueryClient();
	const status = useQuery(
		spaceStatusQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
			enabled: true,
		})
	);
	const members = useQuery(
		spaceMembersQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
			enabled: true,
		})
	);
	const mutation = useMutation({
		mutationFn: (ownership: { userId: string; role: "owner" | "member" }) =>
			createUnscopedWebSpaceApi({
				openMeldProfileId: input.openMeldProfileId,
			}).updateMeta({
				spaceId: input.spaceId,
				ownership,
			}),
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey: spaceQueryKeys.all });
		},
	});
	const owners = status.data?.ownerUserIds ?? [];
	const people = (members.data?.humans ?? []).filter(
		(person) => person.status === "active"
	);
	const filtered = people.filter((person) =>
		person.profileName.toLowerCase().includes(search.toLowerCase())
	);
	const visible = filtered.slice(page * 10, (page + 1) * 10);
	return (
		<section className="border-border/60 border-t pt-4">
			<Accordion>
				<AccordionItem value="members">
					<AccordionTrigger className="py-1 text-sm">
						Members{members.data ? ` · ${people.length}` : ""}
					</AccordionTrigger>
					<AccordionContent>
						<div className="grid gap-3 pt-3">
							<p className="text-muted-foreground text-xs">
								Owners manage this Space. Keep at least one owner so your team
								can continue using it.
							</p>
							{members.isError || status.isError ? (
								<p className="text-destructive text-xs" role="alert">
									Couldn't load members.{" "}
									<Button
										onClick={() => {
											members.refetch();
											status.refetch();
										}}
										size="sm"
										variant="ghost"
									>
										Try again
									</Button>
								</p>
							) : null}
							{people.length > 10 ? (
								<Input
									aria-label="Search members"
									onChange={(event) => {
										setSearch(event.target.value);
										setPage(0);
									}}
									placeholder="Search members"
									value={search}
								/>
							) : null}
							{visible.map((person) => (
								<div
									className="flex items-center justify-between gap-3"
									key={person.profileId}
								>
									<span className="truncate text-sm">{person.profileName}</span>
									{input.canManage &&
									person.ownerUserId &&
									internalUserIds.has(person.ownerUserId) ? (
										<Select
											disabled={mutation.isPending || status.isPending}
											onValueChange={(role) => {
												if (
													(role === "owner" || role === "member") &&
													person.ownerUserId
												) {
													mutation.mutate({ userId: person.ownerUserId, role });
												}
											}}
											value={
												owners.includes(person.ownerUserId) ? "owner" : "member"
											}
										>
											<SelectTrigger
												aria-label={`Role for ${person.profileName}`}
												className="w-fit min-w-0"
												displayValue={
													owners.includes(person.ownerUserId)
														? "Owner"
														: "Member"
												}
											/>
											<SelectContent>
												<SelectItem index={0} value="owner">
													Owner
												</SelectItem>
												<SelectItem index={1} value="member">
													Member
												</SelectItem>
											</SelectContent>
										</Select>
									) : (
										<span className="text-muted-foreground text-xs">
											{describeSpaceMemberRole(
												person.ownerUserId,
												owners,
												internalUserIds,
												directory.isSuccess
											)}
										</span>
									)}
								</div>
							))}
							{filtered.length > 10 ? (
								<div className="flex justify-end gap-2">
									<Button
										disabled={page === 0}
										onClick={() => setPage(page - 1)}
										size="sm"
										variant="ghost"
									>
										Previous
									</Button>
									<Button
										disabled={(page + 1) * 10 >= filtered.length}
										onClick={() => setPage(page + 1)}
										size="sm"
										variant="ghost"
									>
										Next
									</Button>
								</div>
							) : null}
							{mutation.error ? (
								<p className="text-destructive text-xs" role="alert">
									{mutation.error.message}
								</p>
							) : null}
						</div>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</section>
	);
}
