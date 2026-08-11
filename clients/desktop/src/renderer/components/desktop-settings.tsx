import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
  SettingsAccountActionCard,
  SettingsAccountCliAccessSection,
  SettingsAccountProfileCard,
  SettingsAccountProfileSection,
  SettingsAccountRoot,
  SettingsAccountSecuritySection,
  SettingsAccountSessionsSection,
} from "@openmeld/ui/components/settings-account";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import { cn } from "@openmeld/ui/lib/utils";
import {
  ArrowSquareOutIcon,
  DesktopTowerIcon,
  ShieldCheckIcon,
  ShieldSlashIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import type {
  AuthView,
  CliProblem,
  DesktopSettingsView,
  ServiceView,
} from "../../shared/view-types";
import { ConfirmDialog } from "./confirm-dialog";
import type {
  DesktopServiceActionBusy,
  LocalAgentsLoadState,
} from "./desktop-computer-cards";
import {
  DesktopComputerServiceCard,
  DesktopLocalAgentsCard,
} from "./desktop-computer-cards";
import { serviceStatusLabel } from "./desktop-service-status";
import type { DesktopSettingsSectionId } from "./desktop-settings-nav";
import {
  DesktopSetupProgress,
  shouldShowDesktopSetupProgress,
} from "./desktop-setup-progress";
import { ToggleSwitch } from "./toggle-switch";

export type { LocalAgentsLoadState } from "./desktop-computer-cards";

const DESKTOP_CONTEXTUAL_MAIN_START_CLASS_NAME = "pt-[1.375rem]";
const LOCAL_CLI_SESSION_META = (
  <span className="flex items-center gap-1">
    <DesktopTowerIcon aria-hidden="true" className="size-3" />
    Local CLI session on this Mac
  </span>
);

type ServiceActionBusy = DesktopServiceActionBusy;

type DesktopSettingsProps = {
  activeSectionId: string;
  agentsLoad: LocalAgentsLoadState;
  auth: AuthView;
  busyAgentId: string | null;
  desktopSettings: DesktopSettingsView | null;
  desktopSettingsBusy: boolean;
  onOpenLocalAgentsGuide: () => void;
  onOpenWeb: () => void;
  onQuitDesktop: () => void;
  onReconnectComputer: () => void;
  onRetry: () => void;
  onSelectSection: (sectionId: DesktopSettingsSectionId) => void;
  onSetOpenAtLogin: (enabled: boolean) => void;
  onSetServiceAutoStart: (enabled: boolean) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onStartService: () => void;
  onStopService: () => void;
  onToggleAgent: (agentId: string, enabled: boolean) => void;
  service: ServiceView;
  serviceActionBusy: ServiceActionBusy;
  serviceAutoStartProblem: CliProblem | null;
  serviceAutoStartBusy: boolean;
  signInBusy: boolean;
  signOutBusy: boolean;
  signOutProblem: CliProblem | null;
};

export function DesktopSettings(props: DesktopSettingsProps) {
  switch (props.activeSectionId) {
    case "account":
      return <AccountSettings {...props} />;
    case "computers":
      return <ComputerSettings {...props} />;
    default:
      return <GeneralSettings {...props} />;
  }
}

function GeneralSettings({
  auth,
  desktopSettings,
  desktopSettingsBusy,
  onQuitDesktop,
  onSelectSection,
  onSetOpenAtLogin,
  service,
}: DesktopSettingsProps) {
  const preferenceProblem = desktopSettings?.problem ?? null;
  const openAtLoginKnown = typeof desktopSettings?.openAtLogin === "boolean";
  const openAtLogin = desktopSettings?.openAtLogin === true;

  return (
    <SettingsPanel>
      <div className="flex flex-col gap-7 py-5" data-slot="desktop-general">
        <GeneralGroup
          description="OpenMeld Service lets Spaces members wake agents on this Mac."
          label="OpenMeld Service"
        >
          <GeneralRow
            action={
              <Button
                className="w-full sm:w-auto"
                onClick={() => onSelectSection("computers")}
                size="sm"
                variant="outline"
              >
                Open Computers
              </Button>
            }
            description={`Current status: ${serviceStatusLabel(
              service
            )}. Manage service controls, auto-start, and local agents from Computers.`}
            error={service.problem?.message}
            label="Service and local agents"
          />
        </GeneralGroup>

        <GeneralGroup label="Desktop app">
          <GeneralRow
            action={
              <ToggleSwitch
                busy={desktopSettingsBusy}
                checked={openAtLogin}
                disabled={!openAtLoginKnown}
                label="Open OpenMeld Desktop at login"
                onChange={onSetOpenAtLogin}
              />
            }
            error={preferenceProblem?.message}
            label="Open OpenMeld Desktop at login"
          />
        </GeneralGroup>

        <GeneralGroup label="Account">
          <GeneralRow
            action={
              <Button
                className="w-full sm:w-auto"
                onClick={() => onSelectSection("account")}
                size="sm"
                variant="outline"
              >
                Open Account
              </Button>
            }
            description={`${accountDescription(
              auth
            )} Manage sign-in and local session actions from Account.`}
            error={auth.problem?.message}
            label="Account settings"
          />
        </GeneralGroup>

        <GeneralGroup label="App actions">
          <GeneralRow
            action={
              <Button
                className="w-full sm:w-auto"
                onClick={onQuitDesktop}
                size="sm"
                variant="destructive"
              >
                Quit OpenMeld Desktop
              </Button>
            }
            description="Closes the app. OpenMeld Service keeps its current state."
            label="Quit OpenMeld Desktop"
          />
        </GeneralGroup>
      </div>
    </SettingsPanel>
  );
}

function GeneralGroup({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description?: string | null;
  label: string;
}) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-3"
      data-slot="desktop-general-group"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-muted-foreground text-xs">{label}</h2>
        {description ? (
          <p className="text-muted-foreground text-xs/relaxed">{description}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function GeneralRow({
  action,
  description,
  error,
  label,
  stacked = false,
}: {
  action: ReactNode;
  description?: string | null;
  error?: string | null;
  label: string;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 py-1",
        stacked
          ? "grid-cols-1"
          : "grid-cols-1 min-[900px]:grid-cols-[minmax(0,1fr)_auto] min-[900px]:items-center"
      )}
      data-slot="desktop-general-row"
    >
      <div className="min-w-0">
        <h3 className="font-medium text-foreground text-sm">{label}</h3>
        {description ? (
          <p className="mt-1 text-muted-foreground text-xs/relaxed">
            {description}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className={cn("min-w-0", stacked && "w-full")}>{action}</div>
    </div>
  );
}

function AccountSettings({
  auth,
  onOpenWeb,
  onSignIn,
  onSignOut,
  signInBusy,
  signOutBusy,
  signOutProblem,
}: DesktopSettingsProps) {
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const signedIn = auth.signedIn === true;

  return (
    <SettingsPanel>
      <SettingsAccountRoot>
        <SettingsAccountProfileSection
          className={DESKTOP_CONTEXTUAL_MAIN_START_CLASS_NAME}
        >
          {signedIn ? (
            <SettingsAccountProfileCard
              avatarAlt={auth.email ?? "OpenMeld account"}
              badge={
                <Badge variant={auth.problem ? "destructive" : "outline"}>
                  {auth.problem ? (
                    <ShieldSlashIcon aria-hidden="true" className="size-3" />
                  ) : (
                    <ShieldCheckIcon aria-hidden="true" className="size-3" />
                  )}
                  {auth.problem ? "Needs attention" : "Signed in"}
                </Badge>
              }
              displayName={accountDisplayName(auth)}
              email={auth.email}
              footerAction={
                <Button
                  disabled={signOutBusy}
                  onClick={() => setConfirmSignOut(true)}
                  size="sm"
                  variant="destructive"
                >
                  <SignOutIcon aria-hidden="true" data-icon="inline-start" />
                  {signOutBusy ? "Signing out..." : "Sign out on this Mac"}
                </Button>
              }
              footerMeta={LOCAL_CLI_SESSION_META}
              initials={accountInitials(auth)}
            />
          ) : (
            <SettingsAccountActionCard
              action={
                <Button disabled={signInBusy} onClick={onSignIn} size="sm">
                  {signInBusy ? "Waiting..." : "Sign in"}
                </Button>
              }
              description={accountDescription(auth)}
              footer={
                auth.problem ? (
                  <p className="text-destructive text-xs" role="alert">
                    {auth.problem.message}
                  </p>
                ) : null
              }
              title="User Profile"
            />
          )}

          <SettingsAccountActionCard
            action={
              signedIn ? (
                <Button onClick={onOpenWeb} size="sm" variant="outline">
                  <ArrowSquareOutIcon
                    aria-hidden="true"
                    data-icon="inline-start"
                  />
                  Open OpenMeld Web
                </Button>
              ) : (
                <Button disabled={signInBusy} onClick={onSignIn} size="sm">
                  {signInBusy ? "Waiting..." : "Sign in"}
                </Button>
              )
            }
            description={
              signedIn
                ? "Manage your profile details in OpenMeld Web. Desktop shows the local account session for this Mac."
                : "Sign in on this Mac before opening account settings in OpenMeld Web."
            }
            title="OpenMeld Web Account"
          />
        </SettingsAccountProfileSection>

        <SettingsAccountCliAccessSection>
          <SettingsAccountActionCard
            action={
              <OpenWebOrSignInAction
                onOpenWeb={onOpenWeb}
                onSignIn={onSignIn}
                signedIn={signedIn}
                signInBusy={signInBusy}
              />
            }
            description="Generate one-time CLI tokens in OpenMeld Web. Desktop does not show or store token values locally."
            title="One-time CLI token"
          />
        </SettingsAccountCliAccessSection>

        <SettingsAccountSecuritySection>
          <SettingsAccountActionCard
            action={
              <OpenWebOrSignInAction
                onOpenWeb={onOpenWeb}
                onSignIn={onSignIn}
                signedIn={signedIn}
                signInBusy={signInBusy}
              />
            }
            description="Password and sign-in provider changes live on OpenMeld Web."
            title="Providers and password"
          />
        </SettingsAccountSecuritySection>

        <SettingsAccountSessionsSection>
          <SettingsAccountActionCard
            action={
              <OpenWebOrSignInAction
                onOpenWeb={onOpenWeb}
                onSignIn={onSignIn}
                signedIn={signedIn}
                signInBusy={signInBusy}
              />
            }
            description="Review browser sessions in OpenMeld Web. This page only shows the local CLI session on this Mac."
            footer={
              signOutProblem ? (
                <p className="text-destructive text-xs" role="alert">
                  {signOutProblem.message}
                </p>
              ) : null
            }
            title="Sessions"
          />
        </SettingsAccountSessionsSection>
      </SettingsAccountRoot>

      <ConfirmDialog
        busy={signOutBusy}
        confirmLabel="Sign out on this Mac"
        confirmVariant="destructive"
        description="Sign out applies only to OpenMeld on this Mac. It clears the local CLI session and profile selection. OpenMeld Web in your browser will stay signed in. OpenMeld Service may be stopped as part of local sign-out cleanup."
        onConfirm={() => {
          setConfirmSignOut(false);
          onSignOut();
        }}
        onOpenChange={setConfirmSignOut}
        open={confirmSignOut}
        title="Sign out on this Mac?"
      />
    </SettingsPanel>
  );
}

function ComputerSettings({
  agentsLoad,
  busyAgentId,
  onOpenLocalAgentsGuide,
  onReconnectComputer,
  onRetry,
  onSetServiceAutoStart,
  onStartService,
  onStopService,
  onToggleAgent,
  service,
  serviceActionBusy,
  serviceAutoStartBusy,
  serviceAutoStartProblem,
}: DesktopSettingsProps) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmReconnect, setConfirmReconnect] = useState(false);
  const setupInProgress = serviceActionBusy === "setup";
  const setupProgressVisible = shouldShowDesktopSetupProgress({
    service,
    setupInProgress,
  });
  const setupProgressMode =
    service.lifecycle === "not_installed" || service.lifecycle === "unknown"
      ? "first_run"
      : "reconnect";

  return (
    <SettingsPanel>
      <SettingsSection
        className={DESKTOP_CONTEXTUAL_MAIN_START_CLASS_NAME}
        description="Service and local agents on this Mac."
        id="desktop-computers"
        title="Computers"
      >
        <div className="grid gap-4">
          <DesktopComputerServiceCard
            footer={
              setupProgressVisible ? (
                <DesktopSetupProgress
                  canRetry={serviceActionBusy === null}
                  mode={setupProgressMode}
                  onRetry={onReconnectComputer}
                  service={service}
                  setupInProgress={setupInProgress}
                />
              ) : null
            }
            onReconnectComputer={() => setConfirmReconnect(true)}
            onSetServiceAutoStart={onSetServiceAutoStart}
            onSetupComputer={onReconnectComputer}
            onStartService={onStartService}
            onStopService={() => setConfirmStop(true)}
            service={service}
            serviceActionBusy={serviceActionBusy}
            serviceAutoStartBusy={serviceAutoStartBusy}
            serviceAutoStartProblem={serviceAutoStartProblem}
          />

          <DesktopLocalAgentsCard
            agentsLoad={agentsLoad}
            busyAgentId={busyAgentId}
            onOpenLocalAgentsGuide={onOpenLocalAgentsGuide}
            onRetry={onRetry}
            onToggleAgent={onToggleAgent}
          />
        </div>
      </SettingsSection>

      <ConfirmDialog
        busy={serviceActionBusy === "stop"}
        confirmLabel="Stop OpenMeld Service"
        confirmVariant="destructive"
        description="This stops OpenMeld Service on this Mac. This Mac cannot receive local Wake work until OpenMeld Service is started again."
        onConfirm={() => {
          setConfirmStop(false);
          onStopService();
        }}
        onOpenChange={setConfirmStop}
        open={confirmStop}
        title="Stop OpenMeld Service?"
      />
      <ConfirmDialog
        busy={serviceActionBusy === "setup"}
        confirmLabel="Reconnect This Computer"
        description="This reruns setup for this Mac and may restart OpenMeld Service. It will not sign you out."
        onConfirm={() => {
          setConfirmReconnect(false);
          onReconnectComputer();
        }}
        onOpenChange={setConfirmReconnect}
        open={confirmReconnect}
        title="Reconnect this computer?"
      />
    </SettingsPanel>
  );
}

function SettingsPanel({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pt-3 pb-6 sm:px-6 lg:px-8">
      {children}
    </div>
  );
}

function accountDescription(auth: AuthView): string {
  if (auth.email) {
    return `Signed in · ${auth.email}.`;
  }
  if (auth.signedIn === false) {
    return "Not signed in on this Mac.";
  }
  return "Account status unavailable.";
}

function accountDisplayName(auth: AuthView): string {
  if (auth.email) {
    return auth.email.split("@")[0]?.trim() || auth.email;
  }
  if (auth.signedIn === true) {
    return "OpenMeld account";
  }
  return "Not signed in";
}

function accountInitials(auth: AuthView): string {
  const source = auth.email?.split("@")[0] ?? "OpenMeld";
  const initials = source
    .match(/[a-zA-Z0-9]/g)
    ?.slice(0, 2)
    .join("");
  return initials ? initials.toUpperCase() : "OpenMeld";
}

function OpenWebOrSignInAction({
  onOpenWeb,
  onSignIn,
  signedIn,
  signInBusy,
}: {
  onOpenWeb: () => void;
  onSignIn: () => void;
  signedIn: boolean;
  signInBusy: boolean;
}) {
  if (!signedIn) {
    return (
      <Button disabled={signInBusy} onClick={onSignIn} size="sm">
        {signInBusy ? "Waiting..." : "Sign in"}
      </Button>
    );
  }

  return (
    <Button onClick={onOpenWeb} size="sm" variant="outline">
      <ArrowSquareOutIcon aria-hidden="true" data-icon="inline-start" />
      Open OpenMeld Web
    </Button>
  );
}
