import { AppOuterRail } from "@openmeld/ui/components/app-outer-rail";
import { SettingsNav } from "@openmeld/ui/components/settings-nav";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import type { SettingsNavItem } from "@openmeld/ui/lib/settings-contract";
import {
  GearSixIcon,
  HouseIcon,
  type Icon,
  UserIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { OpenMeldLogo } from "./openmeld-logo";

export type StatusWindowDestination = "home" | "profiles" | "settings";

const DESTINATIONS = [
  {
    id: "home",
    label: "Home",
    icon: <RailIcon Icon={HouseIcon} />,
  },
  {
    id: "profiles",
    label: "Directory",
    icon: <RailIcon Icon={UserIcon} />,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <RailIcon Icon={GearSixIcon} />,
  },
] as const;

type StatusWindowShellProps = {
  accountLabel: string | null;
  activeDestination: StatusWindowDestination;
  activeProfilesSectionId: string;
  activeSettingsSectionId: string;
  children: ReactNode;
  headerActions?: ReactNode;
  onDestinationChange: (destination: StatusWindowDestination) => void;
  onProfilesSectionChange: (sectionId: string) => void;
  onSettingsSectionChange: (sectionId: string) => void;
  profilesItems: readonly SettingsNavItem[];
  settingsItems: readonly SettingsNavItem[];
};

const APP_HEADER_TITLE_CLASS_NAME =
  "min-w-0 truncate font-medium text-foreground text-sm";
const APP_HEADER_DESCRIPTION_CLASS_NAME =
  "min-w-0 truncate text-muted-foreground text-xs";

export function StatusWindowShell({
  accountLabel,
  activeDestination,
  activeProfilesSectionId,
  activeSettingsSectionId,
  children,
  headerActions,
  onDestinationChange,
  onProfilesSectionChange,
  onSettingsSectionChange,
  profilesItems,
  settingsItems,
}: StatusWindowShellProps) {
  const [outerRailCollapsed, setOuterRailCollapsed] = useState(true);
  const sectionRail = resolveSectionRail({
    activeDestination,
    activeProfilesSectionId,
    activeSettingsSectionId,
    onProfilesSectionChange,
    onSettingsSectionChange,
    profilesItems,
    settingsItems,
  });

  return (
    <div
      className="flex h-full min-h-0 w-full bg-background text-foreground"
      data-slot="app-frame"
    >
      <AppOuterRail
        account={{ label: accountLabel }}
        accountActive={activeDestination === "settings"}
        activeDestinationId={activeDestination}
        collapsed={outerRailCollapsed}
        destinations={DESTINATIONS}
        expandedBrand={<OpenMeldLogo className="text-foreground" size={4.25} />}
        onAccountNavigate={() => {
          onDestinationChange("settings");
          onSettingsSectionChange("account");
        }}
        onBrandNavigate={() => onDestinationChange("home")}
        onCollapsedChange={setOuterRailCollapsed}
        onNavigate={(destinationId) => {
          if (
            destinationId === "home" ||
            destinationId === "profiles" ||
            destinationId === "settings"
          ) {
            onDestinationChange(destinationId);
          }
        }}
        sidebarSlot="app-frame-rail"
      />

      {sectionRail ? (
        <div
          className="flex min-h-0 shrink-0 flex-col border-border border-r bg-background text-sidebar-foreground"
          data-slot="app-frame-rail-list"
        >
          {sectionRail}
        </div>
      ) : null}

      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
        data-slot="app-frame-main"
      >
        <header
          className="relative z-20 h-[var(--space-conversation-header-height)] shrink-0 overflow-visible border-border border-b"
          data-slot="app-frame-header"
        >
          <StatusWindowHeader
            actions={headerActions}
            destination={activeDestination}
          />
        </header>
        <main
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
          data-slot="app-frame-content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function StatusWindowHeader({
  actions,
  destination,
}: {
  actions?: ReactNode;
  destination: StatusWindowDestination;
}) {
  const headerCopy = resolveHeaderCopy(destination);

  return (
    <div className="drag-region flex h-full items-center justify-between gap-4 px-5">
      <div className="min-w-0">
        <h1 className={APP_HEADER_TITLE_CLASS_NAME}>{headerCopy.title}</h1>
        <p className={APP_HEADER_DESCRIPTION_CLASS_NAME}>
          {headerCopy.description}
        </p>
      </div>
      {actions ? (
        <div className="no-drag flex shrink-0 items-center gap-1">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function resolveHeaderCopy(destination: StatusWindowDestination): {
  description: string;
  title: string;
} {
  switch (destination) {
    case "profiles":
      return {
        title: "Profiles",
        description: "Manage Space identities.",
      };
    case "settings":
      return {
        title: "Settings",
        description:
          "Manage OpenMeld Desktop, this computer, and Web account handoffs.",
      };
    default:
      return {
        title: "Home",
        description: "Current OpenMeld Desktop state for this Mac.",
      };
  }
}

function resolveSectionRail({
  activeDestination,
  activeProfilesSectionId,
  activeSettingsSectionId,
  onProfilesSectionChange,
  onSettingsSectionChange,
  profilesItems,
  settingsItems,
}: {
  activeDestination: StatusWindowDestination;
  activeProfilesSectionId: string;
  activeSettingsSectionId: string;
  onProfilesSectionChange: (sectionId: string) => void;
  onSettingsSectionChange: (sectionId: string) => void;
  profilesItems: readonly SettingsNavItem[];
  settingsItems: readonly SettingsNavItem[];
}) {
  if (activeDestination === "profiles") {
    return (
      <SectionRail
        activeSectionId={activeProfilesSectionId}
        ariaLabel="Profiles"
        description="Manage Space identities."
        items={profilesItems}
        onNavigate={onProfilesSectionChange}
        title="Profiles"
      />
    );
  }

  if (activeDestination === "settings") {
    return (
      <SectionRail
        activeSectionId={activeSettingsSectionId}
        ariaLabel="Settings"
        description="Desktop settings."
        items={settingsItems}
        onNavigate={onSettingsSectionChange}
        title="Settings"
      />
    );
  }

  return undefined;
}

function SectionRail({
  activeSectionId,
  ariaLabel,
  description,
  items,
  onNavigate,
  title,
}: {
  activeSectionId: string;
  ariaLabel: string;
  description: string;
  items: readonly SettingsNavItem[];
  onNavigate: (sectionId: string) => void;
  title: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex h-full min-h-0 w-56 flex-col bg-background text-sidebar-foreground"
    >
      <div className="flex h-[var(--space-conversation-header-height)] shrink-0 flex-col justify-center gap-1 overflow-hidden border-border border-b px-3 py-0">
        <h2 className={APP_HEADER_TITLE_CLASS_NAME}>{title}</h2>
        <p className={APP_HEADER_DESCRIPTION_CLASS_NAME}>{description}</p>
      </div>
      <ScrollArea
        className="min-h-0 flex-1"
        contentClassName="px-3 py-3"
        orientation="vertical"
      >
        <SettingsNav
          activeSectionId={activeSectionId}
          items={items}
          onNavigate={onNavigate}
        />
      </ScrollArea>
    </nav>
  );
}

function RailIcon({ Icon }: { Icon: Icon }) {
  return <Icon aria-hidden="true" className="size-4" />;
}
