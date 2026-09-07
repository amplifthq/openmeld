import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { Surface } from "@openmeld/ui/fluid/surface";
import {
	CalendarBlankIcon,
	EnvelopeIcon,
	MonitorIcon,
	UserCheckIcon,
	UserIcon,
	WifiHighIcon,
} from "@phosphor-icons/react";

export function UserAvatarCardSkeleton() {
	return (
		<Card className="h-full">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<UserIcon className="size-5" />
					User Profile
				</CardTitle>
				<CardDescription>Your account information and status.</CardDescription>
				<CardAction>
					<Skeleton className="h-5 w-20" />
				</CardAction>
			</CardHeader>
			<CardContent>
				<div className="flex items-center gap-4">
					<Skeleton className="size-16 rounded-full" />
					<div className="space-y-1.5">
						<Skeleton className="h-4 w-28" />
						<div className="flex items-center gap-1">
							<EnvelopeIcon className="size-3 text-muted-foreground" />
							<Skeleton className="h-3 w-40" />
						</div>
					</div>
				</div>
			</CardContent>
			<CardFooter className="mt-auto flex-wrap justify-between gap-3">
				<div className="flex items-center gap-1">
					<CalendarBlankIcon className="size-3 text-muted-foreground" />
					<Skeleton className="h-3 w-32" />
				</div>
				<Skeleton className="h-7 w-24" />
			</CardFooter>
		</Card>
	);
}

export function UserNameCardSkeleton() {
	return (
		<Card className="h-full">
			<CardHeader>
				<CardTitle>Display Name</CardTitle>
				<CardDescription>
					Please enter your full name, or a display name you are comfortable
					with. Shown to others in your spaces, up to 32 characters.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-center gap-2">
					<Skeleton className="h-8 flex-1" />
					<Skeleton className="h-3 w-8" />
				</div>
			</CardContent>
			<CardFooter className="mt-auto justify-end">
				<Skeleton className="h-7 w-16" />
			</CardFooter>
		</Card>
	);
}

export function ProvidersManagementCardSkeleton() {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<UserCheckIcon className="size-5" />
					Sign-in Methods
				</CardTitle>
				<CardDescription>Manage your sign-in providers.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{Array.from({ length: 5 }).map((_, index) => (
					<Surface
						className="flex items-center justify-between gap-3 p-3"
						key={String(index)}
					>
						<div className="space-y-1">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-3 w-36" />
						</div>
						<Skeleton className="h-7 w-20" />
					</Surface>
				))}
			</CardContent>
		</Card>
	);
}

export function PasswordChangeCardSkeleton() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Password Security</CardTitle>
				<CardDescription>Manage your password settings.</CardDescription>
			</CardHeader>
			<CardContent>
				<Skeleton className="h-8 w-full" />
			</CardContent>
		</Card>
	);
}

export function SessionsManagementCardSkeleton() {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<WifiHighIcon className="size-5" />
					Sessions
				</CardTitle>
				<CardDescription>
					Manage your active sessions and connected devices.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{Array.from({ length: 3 }).map((_, index) => (
					<Surface
						className="flex items-center justify-between gap-3 p-3"
						key={String(index)}
					>
						<div className="flex items-center gap-2">
							<MonitorIcon className="size-4 text-muted-foreground" />
							<div className="space-y-1">
								<Skeleton className="h-4 w-28" />
								<Skeleton className="h-3 w-24" />
							</div>
						</div>
						<Skeleton className="h-7 w-20" />
					</Surface>
				))}
			</CardContent>
		</Card>
	);
}
