import { describe, expect, it, vi } from "vitest";
import {
  createOpenMeldEmailIdentityPlugin,
  normalizeOpenMeldUserEmail,
} from "../src/plugins/openmeld-email-identity";

describe("OpenMeld email identity plugin", () => {
  it("owns the existing normalized email database contract", () => {
    const plugin = createOpenMeldEmailIdentityPlugin({
      validator: () => true,
    });

    expect(plugin.schema).toEqual({
      user: {
        fields: {
          normalizedEmail: {
            input: false,
            required: false,
            returned: false,
            type: "string",
            unique: true,
          },
        },
      },
    });
  });

  it("preserves email normalization on user creation and update", async () => {
    await expect(
      normalizeOpenMeldUserEmail({
        email: "John.Doe+alerts@gmail.com",
        name: "John",
      })
    ).resolves.toEqual({
      data: {
        email: "John.Doe+alerts@gmail.com",
        name: "John",
        normalizedEmail: "johndoe@gmail.com",
      },
    });
    await expect(
      normalizeOpenMeldUserEmail({
        email: "Person@Example.COM",
        name: "Person",
      })
    ).resolves.toEqual({
      data: {
        email: "Person@Example.COM",
        name: "Person",
        normalizedEmail: "person@example.com",
      },
    });
  });

  it("validates every email entry path without blocking disposable domains", async () => {
    const validator = vi.fn((email: string) => email !== "invalid-email");
    const plugin = createOpenMeldEmailIdentityPlugin({ validator });
    const validationHook = plugin.hooks?.before?.[0];
    const context = {
      body: { email: "person@mailinator.com" },
      path: "/sign-in/magic-link",
      query: undefined,
    };

    expect(validationHook?.matcher(context as never)).toBe(true);
    await expect(
      validationHook?.handler(context as never)
    ).resolves.toBeUndefined();
    expect(validator).toHaveBeenCalledWith("person@mailinator.com");

    await expect(
      validationHook?.handler({
        ...context,
        body: { email: "invalid-email" },
      } as never)
    ).rejects.toMatchObject({
      message: "Invalid email",
      status: "BAD_REQUEST",
    });
  });

  it("validates the replacement address for change-email", async () => {
    const validator = vi.fn(() => true);
    const plugin = createOpenMeldEmailIdentityPlugin({ validator });
    const validationHook = plugin.hooks?.before?.[0];

    await validationHook?.handler({
      body: { newEmail: "next@example.com" },
      path: "/change-email",
      query: undefined,
    } as never);

    expect(validator).toHaveBeenCalledWith("next@example.com");
  });
});
