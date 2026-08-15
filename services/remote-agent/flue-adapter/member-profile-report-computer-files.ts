import type { WorkspaceClient } from "@cloudflare/computer";
import {
  buildCenterAgentProfileReportComputerPath,
  CENTER_AGENT_PROFILE_REPORT_COMPUTER_ROOT,
} from "@openmeld/schemas";
import type { ProfileReportType } from "@openmeld/schemas/types";

export const MEMBER_PROFILE_REPORT_COMPUTER_ROOT =
  CENTER_AGENT_PROFILE_REPORT_COMPUTER_ROOT;
const ISO_CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export type MemberProfileReportComputerFileStore = {
  write(input: {
    content: string;
    documentId: string;
    documentTitle: string;
    profileReportFolderName: string;
    profileReportType: ProfileReportType;
    reportDate: string;
    subjectUserId: string;
  }): Promise<{ path: string }>;
};

export function createMemberProfileReportComputerFileStore(input: {
  workspace: WorkspaceClient;
}): MemberProfileReportComputerFileStore {
  return {
    async write(report) {
      const path = buildMemberProfileReportComputerPath(report);
      await input.workspace.fs.mkdir(parentDirectory(path), {
        recursive: true,
      });
      await input.workspace.fs.writeFile(path, report.content);
      return { path };
    },
  };
}

export function buildMemberProfileReportComputerPath(input: {
  documentTitle: string;
  profileReportFolderName: string;
  profileReportType: ProfileReportType;
  reportDate: string;
  subjectUserId: string;
}): string {
  if (!(input.subjectUserId.trim() && input.profileReportFolderName.trim())) {
    throw new Error("Profile Report files require a subject.");
  }
  if (!isIsoCalendarDate(input.reportDate)) {
    throw new Error("Profile Report files require a valid report date.");
  }
  const reportLabel = resolveProfileReportTypeLabel(input.profileReportType);
  const documentTitle = input.documentTitle.trim();
  if (
    !(
      documentTitle.startsWith(input.reportDate) &&
      documentTitle.includes(reportLabel)
    )
  ) {
    throw new Error(
      "Profile Report file names must keep the report date and type assigned by Core."
    );
  }
  return buildCenterAgentProfileReportComputerPath({
    documentTitle,
    profileReportFolderName: input.profileReportFolderName,
  });
}

function resolveProfileReportTypeLabel(type: ProfileReportType): string {
  switch (type) {
    case "work_profile":
      return "Work Profile";
    default:
      throw new Error(`Unsupported Profile Report type: ${type}`);
  }
}

function isIsoCalendarDate(value: string): boolean {
  if (!ISO_CALENDAR_DATE_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function parentDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}
