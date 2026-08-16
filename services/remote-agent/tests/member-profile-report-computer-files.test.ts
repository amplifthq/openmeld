import type { WorkspaceClient } from "@cloudflare/computer";
import { describe, expect, it, vi } from "vitest";
import {
  buildMemberProfileReportComputerPath,
  createMemberProfileReportComputerFileStore,
} from "../flue-adapter/member-profile-report-computer-files";

describe("Center Agent Computer Profile Report files", () => {
  it("keeps dated reports under Documents, Profile Reports, and the person's name", async () => {
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const store = createMemberProfileReportComputerFileStore({
      workspace: {
        fs: { mkdir, writeFile },
      } as unknown as WorkspaceClient,
    });

    await expect(
      store.write({
        content: "# Morgan Lee\n\nStill learning.",
        documentId: "document-1",
        documentTitle: "2026-08-14 — Work Profile",
        profileReportType: "work_profile",
        reportDate: "2026-08-14",
        profileReportFolderName: "Morgan Lee",
        subjectUserId: "user/morgan",
      })
    ).resolves.toEqual({
      path: "/computer/home/documents/Profile Reports/Morgan Lee/2026-08-14 — Work Profile.md",
    });
    expect(mkdir).toHaveBeenCalledWith(
      "/computer/home/documents/Profile Reports/Morgan Lee",
      { recursive: true }
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/computer/home/documents/Profile Reports/Morgan Lee/2026-08-14 — Work Profile.md",
      "# Morgan Lee\n\nStill learning."
    );
  });

  it("uses Core's distinct title as the one file name instead of probing with expected write failures", async () => {
    const writeFile = vi.fn(async () => undefined);
    const store = createMemberProfileReportComputerFileStore({
      workspace: {
        fs: { mkdir: vi.fn(async () => undefined), writeFile },
      } as unknown as WorkspaceClient,
    });

    await expect(
      store.write({
        content: "# Morgan Lee\n\nA second angle.",
        documentId: "document-2",
        documentTitle: "2026-08-14 — Work Profile (2)",
        profileReportType: "work_profile",
        reportDate: "2026-08-14",
        profileReportFolderName: "Morgan Lee",
        subjectUserId: "user/morgan",
      })
    ).resolves.toEqual({
      path: "/computer/home/documents/Profile Reports/Morgan Lee/2026-08-14 — Work Profile (2).md",
    });
    expect(writeFile).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledWith(
      "/computer/home/documents/Profile Reports/Morgan Lee/2026-08-14 — Work Profile (2).md",
      "# Morgan Lee\n\nA second angle."
    );
  });

  it("uses Core's collision-resolved person folder instead of the display name", () => {
    expect(
      buildMemberProfileReportComputerPath({
        documentTitle: "2026-08-14 — Work Profile (2)",
        profileReportFolderName: "Morgan Lee (2)",
        profileReportType: "work_profile",
        reportDate: "2026-08-14",
        subjectUserId: "user/morgan",
      })
    ).toBe(
      "/computer/home/documents/Profile Reports/Morgan Lee (2)/2026-08-14 — Work Profile (2).md"
    );
  });

  it("rejects missing identity or an invalid date instead of escaping the report root", () => {
    expect(() =>
      buildMemberProfileReportComputerPath({
        documentTitle: "2026-08-14 — Work Profile",
        profileReportFolderName: "Morgan Lee",
        profileReportType: "work_profile",
        reportDate: "2026/08/14",
        subjectUserId: "user/morgan",
      })
    ).toThrow("valid report date");
    expect(() =>
      buildMemberProfileReportComputerPath({
        documentTitle: "2026-08-14 — Work Profile",
        profileReportFolderName: "   ",
        profileReportType: "work_profile",
        reportDate: "2026-08-14",
        subjectUserId: "   ",
      })
    ).toThrow("require a subject");
  });
});
