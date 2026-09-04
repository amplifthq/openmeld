import type { LocalProjectControlDaemonFrame } from "@openmeld/schemas/types";

export function didLocalProjectConnectionsChange(
  frame: LocalProjectControlDaemonFrame
): boolean {
  switch (frame.code) {
    case "daemon.local_project_control.connect_candidate_result":
    case "daemon.local_project_control.connect_declared_path_result":
      return (
        "status" in frame.payload.result &&
        frame.payload.result.status === "connected"
      );
    case "daemon.local_project_control.remove_connection_result":
      return (
        "status" in frame.payload.result &&
        frame.payload.result.status === "removed"
      );
    case "daemon.local_project_control.remove_missing_connections_result":
      return (
        "removedCount" in frame.payload.result &&
        frame.payload.result.removedCount > 0
      );
    case "daemon.local_project_control.set_default_connection_result":
      return (
        "status" in frame.payload.result &&
        frame.payload.result.status === "updated"
      );
    default:
      return false;
  }
}
