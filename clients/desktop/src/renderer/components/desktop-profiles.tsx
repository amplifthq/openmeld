import { Button } from "@openmeld/ui/components/button";
import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import type { SettingsNavItem } from "@openmeld/ui/lib/settings-contract";
import type { ReactNode } from "react";
import type { AuthView } from "../../shared/view-types";

export const DESKTOP_PROFILES_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "agent-profiles",
    title: "Agent Profiles",
  },
  {
    id: "human-profiles",
    title: "People",
  },
] as const;

export type DesktopProfilesSectionId =
  (typeof DESKTOP_PROFILES_NAV_ITEMS)[number]["id"];

type DesktopProfilesProps = {
  activeSectionId: string;
  auth: AuthView;
  onOpenWeb: () => void;
  onSignIn: () => void;
  signInBusy: boolean;
};

export function DesktopProfiles(props: DesktopProfilesProps) {
  if (props.activeSectionId === "human-profiles") {
    return (
      <ProfilesHandoffPanel
        auth={props.auth}
        description="People are managed in OpenMeld Web for now."
        onOpenWeb={props.onOpenWeb}
        onSignIn={props.onSignIn}
        rowDescription="Create and manage teammate identities in OpenMeld Web."
        signedOutDescription="Sign in before managing people."
        signInBusy={props.signInBusy}
        title="People"
        webButtonLabel="Open OpenMeld Web"
      />
    );
  }

  return (
    <ProfilesHandoffPanel
      auth={props.auth}
      description="Account-level Agent Profiles live on OpenMeld Web. Desktop keeps this Mac ready for local work."
      onOpenWeb={props.onOpenWeb}
      onSignIn={props.onSignIn}
      rowDescription="Create, rename, and review account-level Agent Profiles in OpenMeld Web."
      signedOutDescription="Sign in before managing Agent Profiles."
      signInBusy={props.signInBusy}
      title="Agent Profiles"
      webButtonLabel="Open OpenMeld Web"
    />
  );
}

function ProfilesHandoffPanel({
  auth,
  description,
  onOpenWeb,
  onSignIn,
  rowDescription,
  signedOutDescription,
  signInBusy,
  title,
  webButtonLabel,
}: {
  auth: AuthView;
  description: string;
  onOpenWeb: () => void;
  onSignIn: () => void;
  rowDescription: string;
  signedOutDescription: string;
  signInBusy: boolean;
  title: string;
  webButtonLabel: string;
}) {
  const signedIn = auth.signedIn === true;

  return (
    <ProfilesPanel>
      <SettingsSection
        description={description}
        id="desktop-profiles"
        title={title}
      >
        <SettingsRow
          control={
            signedIn ? (
              <Button onClick={onOpenWeb} size="sm" variant="outline">
                {webButtonLabel}
              </Button>
            ) : (
              <Button disabled={signInBusy} onClick={onSignIn} size="sm">
                {signInBusy ? "Waiting..." : "Sign In"}
              </Button>
            )
          }
          description={signedIn ? rowDescription : signedOutDescription}
          error={auth.problem?.message}
          label={title}
          status={auth.problem ? "error" : "idle"}
        />
      </SettingsSection>
    </ProfilesPanel>
  );
}

function ProfilesPanel({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col px-5 pt-3 pb-8">
      {children}
    </div>
  );
}
