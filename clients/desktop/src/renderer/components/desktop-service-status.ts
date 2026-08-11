import type { ServiceView } from "../../shared/view-types";

export function serviceStatusLabel(service: ServiceView): string {
  switch (service.lifecycle) {
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    case "not_installed":
      return "Not installed";
    default:
      return "Unknown";
  }
}
