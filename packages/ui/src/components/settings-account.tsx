import { EnvelopeIcon, UserIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "#components/avatar";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#components/card";
import { SettingsSection } from "#components/settings-section";
import { cn } from "#lib/utils";

const ACCOUNT_PROFILE_DESCRIPTION = "How you appear to others in your spaces.";
const ACCOUNT_CLI_ACCESS_DESCRIPTION =
  "Generate a one-time token to connect the OpenMeld CLI to your account.";
const ACCOUNT_SECURITY_DESCRIPTION =
  "Manage how you sign in and keep your account secure.";
const ACCOUNT_SESSIONS_DESCRIPTION =
  "Review and revoke the devices and browsers signed in to your account.";

type SettingsAccountSectionProps = {
  children: ReactNode;
  className?: string;
};

export function SettingsAccountRoot({
  children,
  className,
}: SettingsAccountSectionProps) {
  return <div className={cn("flex flex-col", className)}>{children}</div>;
}

export function SettingsAccountProfileSection({
  children,
  className,
}: SettingsAccountSectionProps) {
  return (
    <SettingsSection
      className={className}
      description={ACCOUNT_PROFILE_DESCRIPTION}
      id="account-profile"
      title="Profile"
    >
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </SettingsSection>
  );
}

export function SettingsAccountCliAccessSection({
  children,
  className,
}: SettingsAccountSectionProps) {
  return (
    <SettingsSection
      className={className}
      description={ACCOUNT_CLI_ACCESS_DESCRIPTION}
      id="account-cli-access"
      title="CLI access"
    >
      {children}
    </SettingsSection>
  );
}

export function SettingsAccountSecuritySection({
  children,
  className,
}: SettingsAccountSectionProps) {
  return (
    <SettingsSection
      className={className}
      description={ACCOUNT_SECURITY_DESCRIPTION}
      id="account-sign-in"
      title="Sign-in & security"
    >
      <div className="flex flex-col gap-4">{children}</div>
    </SettingsSection>
  );
}

export function SettingsAccountSessionsSection({
  children,
  className,
}: SettingsAccountSectionProps) {
  return (
    <SettingsSection
      className={className}
      description={ACCOUNT_SESSIONS_DESCRIPTION}
      id="account-sessions"
      title="Sessions"
    >
      {children}
    </SettingsSection>
  );
}

export type SettingsAccountProfileCardProps = {
  avatar?: ReactNode;
  avatarAlt: string;
  avatarSrc?: string | null;
  badge?: ReactNode;
  className?: string;
  description?: string;
  displayName: string;
  email?: string | null;
  footerAction?: ReactNode;
  footerMeta?: ReactNode;
  heading?: ReactNode;
  initials: string;
  profileAction?: ReactNode;
};

export function SettingsAccountProfileCard({
  avatar,
  avatarAlt,
  avatarSrc,
  badge,
  className,
  description = "Your account information and status.",
  displayName,
  email,
  footerAction,
  footerMeta,
  heading,
  initials,
  profileAction,
}: SettingsAccountProfileCardProps) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {heading ?? (
            <>
              <UserIcon aria-hidden="true" className="size-5" />
              User Profile
            </>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {badge ? <CardAction>{badge}</CardAction> : null}
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          {avatar ?? (
            <Avatar className="size-16">
              {avatarSrc ? (
                <AvatarImage
                  alt={avatarAlt}
                  referrerPolicy="no-referrer"
                  src={avatarSrc}
                />
              ) : null}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          )}
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="truncate font-medium text-sm">{displayName}</p>
              {email ? (
                <p
                  className="flex items-center gap-1 text-muted-foreground text-xs"
                  data-slot="settings-account-profile-email"
                >
                  <EnvelopeIcon aria-hidden="true" className="size-3" />
                  <span className="truncate">{email}</span>
                </p>
              ) : null}
            </div>
            {profileAction ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {profileAction}
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
      {footerMeta || footerAction ? (
        <CardFooter className="mt-auto flex-wrap justify-between gap-3">
          <div className="min-w-0 text-muted-foreground text-xs">
            {footerMeta}
          </div>
          {footerAction}
        </CardFooter>
      ) : null}
    </Card>
  );
}

export type SettingsAccountActionCardProps = {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  description: string;
  footer?: ReactNode;
  title: string;
};

export function SettingsAccountActionCard({
  action,
  children,
  className,
  description,
  footer,
  title,
}: SettingsAccountActionCardProps) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
      {footer ? <CardFooter className="mt-auto">{footer}</CardFooter> : null}
    </Card>
  );
}
