import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { OrganizationSkillDetailPage } from "./organization-skill-detail-page";

const getCurrentOrganizationSkillMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useNavigate: () => vi.fn(),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "organization-1",
			name: "Acme",
			slug: "acme",
		},
	}),
}));

vi.mock("#/lib/organizations/organization-skills", async (importOriginal) => ({
	...(await importOriginal()),
	getCurrentOrganizationSkill: getCurrentOrganizationSkillMock,
}));

vi.mock("#/components/forms/unsaved-changes-guard", () => ({
	UnsavedChangesGuard: () => null,
}));

describe("OrganizationSkillDetailPage", () => {
	beforeEach(() => {
		getCurrentOrganizationSkillMock.mockReset().mockResolvedValue({
			skill: {
				activeRelease: {
					createdAt: "2026-08-24T01:00:00.000Z",
					createdByUserId: "user-1",
					digest: "a".repeat(64),
					id: "release-1",
					source: { kind: "created" },
				},
				bundle: {
					files: [],
					instructions: "Review every supported viewport.",
					portable: {
						allowedTools: null,
						compatibility: null,
						description: "Keep every compact control reachable.",
						license: null,
						metadata: {},
						name: "responsive-product-audit-across-every-supported-screen-size",
					},
				},
				createdAt: "2026-08-24T01:00:00.000Z",
				description: "Keep every compact control reachable.",
				enabled: true,
				id: "skill-1",
				maintainerUserIds: ["user-1"],
				name: "responsive-product-audit-across-every-supported-screen-size",
				organizationId: "organization-1",
				permissions: { canEdit: true, canManage: false },
				releases: [
					{
						createdAt: "2026-08-24T01:00:00.000Z",
						createdByUserId: "user-1",
						digest: "a".repeat(64),
						id: "release-1",
						source: { kind: "created" },
					},
				],
				source: { kind: "created" },
				updatedAt: "2026-08-24T01:00:00.000Z",
				version: 1,
			},
		});
	});

	afterEach(cleanup);

	it("wraps long names and keeps Save in normal flow on compact screens", async () => {
		render(
			<TestQueryClientProvider>
				<OrganizationSkillDetailPage skillId="skill-1" />
			</TestQueryClientProvider>
		);

		const heading = await screen.findByRole("heading", {
			name: "responsive-product-audit-across-every-supported-screen-size",
		});
		expect(heading.className).toContain("max-lg:break-words");
		expect(heading.className).toContain("lg:truncate");
		const save = screen.getByRole("button", { name: "Save" });
		expect(save.parentElement?.className).toContain("lg:sticky");
		expect(save.parentElement?.className).toContain("lg:bottom-4");
		expect(save.parentElement?.classList.contains("sticky")).toBe(false);
	});
});
