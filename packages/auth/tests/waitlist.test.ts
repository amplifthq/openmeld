import { describe, expect, it } from "vitest";
import type {
  WaitlistEmailRecord,
  WaitlistRepository,
} from "../src/waitlist/waitlist-repository";
import {
  createWaitlistService,
  normalizeWaitlistEmail,
} from "../src/waitlist/waitlist-service";

function createInMemoryWaitlistRepository(
  initial: WaitlistEmailRecord[] = []
): WaitlistRepository {
  const records = [...initial];

  return {
    findByEmail(email) {
      return Promise.resolve(
        records.find((record) => record.email === email) ?? null
      );
    },
    insertEmail(email) {
      if (records.some((record) => record.email === email)) {
        return Promise.resolve(false);
      }

      records.push({
        email,
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
      });
      return Promise.resolve(true);
    },
  };
}

describe("waitlist service", () => {
  it("creates a waitlist record for a new email", async () => {
    const repository = createInMemoryWaitlistRepository();
    const service = createWaitlistService(repository);

    await expect(
      service.joinWaitlist({ email: "new@example.com" })
    ).resolves.toEqual({
      email: "new@example.com",
      status: "created",
    });
  });

  it("returns already_exists for duplicate email submissions", async () => {
    const repository = createInMemoryWaitlistRepository([
      {
        email: "existing@example.com",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
      },
    ]);
    const service = createWaitlistService(repository);

    await expect(
      service.joinWaitlist({ email: "existing@example.com" })
    ).resolves.toEqual({
      email: "existing@example.com",
      status: "already_exists",
    });
  });

  it("normalizes waitlist emails before checking for duplicates", async () => {
    const repository = createInMemoryWaitlistRepository([
      {
        email: "foo@bar.com",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
      },
    ]);
    const service = createWaitlistService(repository);

    expect(normalizeWaitlistEmail(" Foo@Bar.com ")).toBe("foo@bar.com");

    await expect(
      service.joinWaitlist({ email: " Foo@Bar.com " })
    ).resolves.toEqual({
      email: "foo@bar.com",
      status: "already_exists",
    });
  });
});
