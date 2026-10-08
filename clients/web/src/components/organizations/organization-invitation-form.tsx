import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import {
	inviteOrganizationMember,
	type OrganizationInviteRole,
} from "#/lib/organizations/auth-organizations";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";

const INVITE_ROLE_OPTIONS = [
	{ label: "Member", value: "member" },
	{ label: "Admin", value: "admin" },
] as const satisfies readonly {
	label: string;
	value: OrganizationInviteRole;
}[];

export function OrganizationInvitationForm(input: { organizationId: string }) {
	const emailId = useId();
	const roleId = useId();
	const queryClient = useQueryClient();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<OrganizationInviteRole>("member");
	const [sentMessage, setSentMessage] = useState<string | null>(null);
	const inviteMutation = useMutation({
		mutationFn: async () =>
			await inviteOrganizationMember({
				email: email.trim(),
				organizationId: input.organizationId,
				role,
			}),
		onSuccess: () => {
			setSentMessage(`Invitation sent to ${email.trim()}.`);
			setEmail("");
			setRole("member");
			Promise.all([
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.invitations(input.organizationId),
				}),
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.directory(input.organizationId),
				}),
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.profileDirectory(
						input.organizationId
					),
				}),
			]).catch(() => undefined);
		},
	});
	const normalizedEmail = email.trim();
	const canSubmit = normalizedEmail.length > 0 && !inviteMutation.isPending;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canSubmit) {
			return;
		}
		setSentMessage(null);
		inviteMutation.mutate();
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Invite members</CardTitle>
				<CardDescription>
					Invite a teammate to join this organization and work together in
					Spaces.
				</CardDescription>
			</CardHeader>
			<CardContent className="@container">
				<form
					className="grid @sm:grid-cols-2 @xl:grid-cols-[minmax(0,1fr)_8rem_auto] @sm:items-end gap-3"
					onSubmit={handleSubmit}
				>
					<div className="@sm:col-span-2 @xl:col-span-1 grid gap-2">
						<Label htmlFor={emailId}>Email</Label>
						<Input
							autoComplete="email"
							disabled={inviteMutation.isPending}
							id={emailId}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="teammate@example.com"
							type="email"
							value={email}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor={roleId}>Role</Label>
						<Select
							disabled={inviteMutation.isPending}
							onValueChange={(value) =>
								setRole(value === "admin" ? "admin" : "member")
							}
							value={role}
						>
							<SelectTrigger
								className="w-full min-w-0"
								displayValue={
									INVITE_ROLE_OPTIONS.find((option) => option.value === role)
										?.label
								}
								id={roleId}
							/>
							<SelectContent>
								{INVITE_ROLE_OPTIONS.map((option, index) => (
									<SelectItem
										index={index}
										key={option.value}
										value={option.value}
									>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<Button disabled={!canSubmit} type="submit">
						<PaperPlaneTiltIcon aria-hidden="true" data-icon="inline-start" />
						Send invitation
					</Button>
				</form>
				{inviteMutation.isError ? (
					<p className="mt-3 text-destructive text-sm">
						{inviteMutation.error.message}
					</p>
				) : null}
				{sentMessage ? (
					<p className="mt-3 text-muted-foreground text-sm">{sentMessage}</p>
				) : null}
			</CardContent>
		</Card>
	);
}
