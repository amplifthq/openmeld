import { describe, expect, it } from "vitest";
import { parseSpaceMetaUpdatePatch } from "../space/rules/parsers/space-meta-patch";
import {
  parseSetSpaceAccessModeBody,
  parseSpaceMetaAtomicCreatePatch,
  parseUpsertSpacePasswordBody,
} from "../space/rules/parsers/space-password-patch";

describe("space parsers", () => {
  describe("parseSpaceMetaUpdatePatch", () => {
    it("accepts trimmed meta fields", () => {
      const parsed = parseSpaceMetaUpdatePatch({
        name: "  demo  ",
        purpose: "  coordinate launch  ",
        guide: "  keep short  ",
      });
      expect(parsed).toEqual({
        ok: true,
        hasAccessMode: false,
        hasOrganizationId: false,
        hasVisibility: false,
        hasName: true,
        name: "demo",
        hasPurpose: true,
        purpose: "coordinate launch",
        hasGuide: true,
        guide: "keep short",
        hasCreator: false,
      });
    });

    it("rejects unknown field", () => {
      const parsed = parseSpaceMetaUpdatePatch({
        name: "demo",
        unknownField: true,
      });
      expect(parsed).toEqual({
        ok: false,
        message: "Unknown field: unknownField",
      });
    });

    it("rejects empty payload", () => {
      const parsed = parseSpaceMetaUpdatePatch({});
      expect(parsed).toEqual({
        ok: false,
        message: "Expected name, purpose, guide or creator",
      });
    });

    it("accepts members-only access during Space initialization", () => {
      const parsed = parseSpaceMetaUpdatePatch(
        {
          accessMode: "members_only",
          organizationId: "org-1",
          visibility: "private",
        },
        {
          allowAccessMode: true,
          allowOrganizationFields: true,
          requireOrganizationFields: true,
        }
      );

      expect(parsed).toEqual({
        ok: true,
        hasAccessMode: true,
        accessMode: "members_only",
        hasOrganizationId: true,
        organizationId: "org-1",
        hasVisibility: true,
        visibility: "private",
        hasName: false,
        hasPurpose: false,
        hasGuide: false,
        hasCreator: false,
      });
    });

    it("rejects access mode through the regular metadata patch", () => {
      expect(parseSpaceMetaUpdatePatch({ accessMode: "members_only" })).toEqual(
        {
          ok: false,
          message: "Unknown field: accessMode",
        }
      );
    });
  });

  describe("parseSpaceMetaAtomicCreatePatch", () => {
    it("accepts valid payload", () => {
      const parsed = parseSpaceMetaAtomicCreatePatch({
        name: "demo",
        organizationId: "org-1",
        visibility: "private",
        password: "Abc!2345",
      });
      expect(parsed).toEqual({
        ok: true,
        accessMode: "protected",
        metaUpdate: {
          hasAccessMode: false,
          hasOrganizationId: true,
          organizationId: "org-1",
          hasVisibility: true,
          visibility: "private",
          hasName: true,
          name: "demo",
          hasPurpose: false,
          hasGuide: false,
          hasCreator: false,
        },
        password: "Abc!2345",
      });
    });

    it("accepts purpose alongside password", () => {
      const parsed = parseSpaceMetaAtomicCreatePatch({
        purpose: " coordinate launch ",
        organizationId: "org-1",
        visibility: "public",
        password: "Abc!2345",
      });
      expect(parsed).toEqual({
        ok: true,
        accessMode: "protected",
        metaUpdate: {
          hasAccessMode: false,
          hasOrganizationId: true,
          organizationId: "org-1",
          hasVisibility: true,
          visibility: "public",
          hasName: false,
          hasPurpose: true,
          purpose: "coordinate launch",
          hasGuide: false,
          hasCreator: false,
        },
        password: "Abc!2345",
      });
    });

    it("accepts public view with password-gated join on create", () => {
      const parsed = parseSpaceMetaAtomicCreatePatch({
        accessMode: "public_view_join_password",
        name: "demo",
        organizationId: "org-1",
        visibility: "private",
        password: "Abc!2345",
      });
      expect(parsed).toEqual({
        ok: true,
        accessMode: "public_view_join_password",
        metaUpdate: {
          hasAccessMode: false,
          hasOrganizationId: true,
          organizationId: "org-1",
          hasVisibility: true,
          visibility: "private",
          hasName: true,
          name: "demo",
          hasPurpose: false,
          hasGuide: false,
          hasCreator: false,
        },
        password: "Abc!2345",
      });
    });

    it("rejects public access when a create password is present", () => {
      const parsed = parseSpaceMetaAtomicCreatePatch({
        accessMode: "public",
        name: "demo",
        organizationId: "org-1",
        visibility: "private",
        password: "Abc!2345",
      });
      expect(parsed).toEqual({
        ok: false,
        message: "Invalid accessMode",
      });
    });

    it("rejects members-only access when a create password is present", () => {
      const parsed = parseSpaceMetaAtomicCreatePatch({
        accessMode: "members_only",
        name: "demo",
        organizationId: "org-1",
        visibility: "private",
        password: "Abc!2345",
      });
      expect(parsed).toEqual({
        ok: false,
        message: "Invalid accessMode",
      });
    });

    it("rejects short password", () => {
      const parsed = parseSpaceMetaAtomicCreatePatch({
        name: "demo",
        organizationId: "org-1",
        visibility: "private",
        password: "12345",
      });
      expect(parsed).toEqual({
        ok: false,
        code: "space.password_too_short",
        message: "Invalid password",
      });
    });
  });

  describe("parseUpsertSpacePasswordBody", () => {
    it("rejects unknown field", () => {
      const parsed = parseUpsertSpacePasswordBody({
        password: "Abc!2345",
        unknown: true,
      });
      expect(parsed).toEqual({
        ok: false,
        code: "invalid_password_payload",
        message: "Unknown field: unknown",
      });
    });

    it("rejects missing password", () => {
      const parsed = parseUpsertSpacePasswordBody({});
      expect(parsed).toEqual({
        ok: false,
        code: "invalid_password_payload",
        message: "Invalid password payload: expected password",
      });
    });

    it("rejects non-string password", () => {
      const parsed = parseUpsertSpacePasswordBody({
        password: 12_345,
      });
      expect(parsed).toEqual({
        ok: false,
        code: "invalid_password_payload",
        message: "Invalid password payload: password must be a string",
      });
    });

    it("rejects short password", () => {
      const parsed = parseUpsertSpacePasswordBody({
        password: "12345",
      });
      expect(parsed).toEqual({
        ok: false,
        code: "space.password_too_short",
        message: "space password must be at least 6 characters",
      });
    });
  });

  describe("parseSetSpaceAccessModeBody", () => {
    it("accepts access mode without password for existing locked Spaces", () => {
      const parsed = parseSetSpaceAccessModeBody({
        accessMode: "public_view_join_password",
      });
      expect(parsed).toEqual({
        ok: true,
        accessMode: "public_view_join_password",
      });
    });

    it("accepts and normalizes the single Space password", () => {
      const parsed = parseSetSpaceAccessModeBody({
        accessMode: "protected",
        password: "  Abc!2345  ",
      });
      expect(parsed).toEqual({
        ok: true,
        accessMode: "protected",
        password: "Abc!2345",
      });
    });

    it("rejects unknown fields and invalid access modes", () => {
      expect(
        parseSetSpaceAccessModeBody({
          accessMode: "public",
          joinPassword: "Abc!2345",
        })
      ).toEqual({
        ok: false,
        code: "invalid_payload",
        message: "Unknown field: joinPassword",
      });

      expect(
        parseSetSpaceAccessModeBody({
          accessMode: "password_protected",
        })
      ).toEqual({
        ok: false,
        code: "invalid_payload",
        message: "Invalid access mode payload: accessMode is invalid",
      });
    });

    it("rejects invalid optional password values", () => {
      expect(
        parseSetSpaceAccessModeBody({
          accessMode: "protected",
          password: 12_345,
        })
      ).toEqual({
        ok: false,
        code: "invalid_payload",
        message: "Invalid access mode payload: password must be a string",
      });

      expect(
        parseSetSpaceAccessModeBody({
          accessMode: "protected",
          password: "12345",
        })
      ).toEqual({
        ok: false,
        code: "space.password_too_short",
        message: "space password must be at least 6 characters",
      });
    });
  });
});
