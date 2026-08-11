import {
  resolveHostCapabilities,
  resolveSettingsSections,
  type SettingsNavItem,
  type SettingsSectionDef,
  toSettingsNavItems,
} from "@openmeld/ui/lib/settings-contract";

const DESKTOP_HOST_CAPABILITIES = resolveHostCapabilities("electron");

const DESKTOP_SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: "general",
    requires: ["ELECTRON_HOST"],
    render: () => null,
    title: "General",
  },
  {
    id: "account",
    requires: ["CLOUD_ACCOUNT"],
    render: () => null,
    title: "Account",
  },
  {
    id: "computers",
    requires: ["LOCAL_SERVICE"],
    render: () => null,
    title: "Computers",
  },
] as const;

export const DESKTOP_SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] =
  toSettingsNavItems(
    resolveSettingsSections(
      DESKTOP_SETTINGS_SECTIONS,
      DESKTOP_HOST_CAPABILITIES
    )
  );

export type DesktopSettingsSectionId =
  (typeof DESKTOP_SETTINGS_NAV_ITEMS)[number]["id"];
