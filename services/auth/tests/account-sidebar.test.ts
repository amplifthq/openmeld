import {
  createAccountSidebarRepository,
  createD1Db,
} from "@openmeld/auth/server";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
  type SqliteD1Harness,
} from "./support/sqlite-d1-harness";

let harness: SqliteD1Harness;
beforeEach(() => {
  harness = createSqliteD1Harness();
  applyDrizzleMigrations(harness.database);
  for (const id of ["alice", "bob"]) {
    harness.run({
      sql: "INSERT INTO users(id,name,email) VALUES(?,?,?)",
      params: [id, id, `${id}@example.com`],
    });
  }
  for (const org of ["one", "two"]) {
    harness.run({
      sql: "INSERT INTO organizations(id,name,slug,created_at) VALUES(?,?,?,0)",
      params: [org, org, org],
    });
    for (const user of ["alice", "bob"]) {
      harness.run({
        sql: "INSERT INTO members(id,user_id,organization_id,created_at) VALUES(?,?,?,0)",
        params: [`${user}-${org}`, user, org],
      });
    }
  }
});
afterEach(() => harness.close());

it("persists personal organization settings across repository instances without exposing another account or organization", async () => {
  const repository = createAccountSidebarRepository(createD1Db(harness.db));
  const original = await repository.read("alice", "one");
  const preferences = {
    ...original.preferences,
    groups: [
      {
        id: "0c1cc2f8-cb19-400f-99af-894dcdeca851",
        name: "Design",
        sort: "manual" as const,
        spaceIds: ["space-a", "space-b"],
      },
    ],
  };
  expect(
    await repository.save("alice", "one", { revision: 0, preferences })
  ).toBe(true);
  const anotherDevice = createAccountSidebarRepository(createD1Db(harness.db));
  expect(await anotherDevice.read("alice", "one")).toEqual({
    revision: 1,
    preferences,
  });
  expect(await anotherDevice.read("bob", "one")).toEqual(original);
  expect(await anotherDevice.read("alice", "two")).toEqual(original);
});

it("rejects stale first writes and updates, preserving the winning device's order", async () => {
  const repository = createAccountSidebarRepository(createD1Db(harness.db));
  const initial = await repository.read("alice", "one");
  expect(await repository.save("alice", "one", initial)).toBe(true);
  expect(await repository.save("alice", "one", initial)).toBe(false);
  const current = await repository.read("alice", "one");
  expect(
    await repository.save("alice", "one", {
      ...current,
      preferences: {
        ...current.preferences,
        pinned: { sort: "manual", spaceIds: ["b", "a"] },
      },
    })
  ).toBe(true);
  expect(await repository.save("alice", "one", current)).toBe(false);
  expect(
    (await repository.read("alice", "one")).preferences.pinned.spaceIds
  ).toEqual(["b", "a"]);
});

it("syncs People preferences without old Space-only clients deleting them", async () => {
  const repository = createAccountSidebarRepository(createD1Db(harness.db));
  const original = await repository.read("alice", "one");
  const people = {
    starred: { sort: "manual" as const, itemIds: ["person-a"] },
    people: { sort: "name" as const, itemIds: [] },
    groups: [],
  };
  const agents = {
    starred: { sort: "manual" as const, itemIds: ["agent-a"] },
    items: { sort: "priority" as const, itemIds: [] },
    groups: [],
  };
  const messages = {
    pinned: { sort: "manual" as const, spaceIds: ["dm-a"] },
    spaces: { sort: "priority" as const, spaceIds: [] },
    groups: [
      {
        id: "0c1cc2f8-cb19-400f-99af-894dcdeca851",
        name: "Design",
        sort: "recent" as const,
        spaceIds: ["dm-b"],
      },
    ],
  };
  const chats = {
    ...messages,
    archivedIds: ["chat-archived"],
    titles: { "chat-a": "Launch checklist" },
  };
  expect(
    await repository.save("alice", "one", {
      revision: 0,
      preferences: { ...original.preferences, people, agents, messages, chats },
    })
  ).toBe(true);
  expect(
    await repository.save("alice", "one", {
      revision: 1,
      preferences: original.preferences,
    })
  ).toBe(true);
  const anotherDevice = createAccountSidebarRepository(createD1Db(harness.db));
  expect((await anotherDevice.read("alice", "one")).preferences.chats).toEqual(
    chats
  );
  expect(
    (await anotherDevice.read("bob", "one")).preferences.chats
  ).toBeUndefined();
  expect(
    (await anotherDevice.read("alice", "two")).preferences.chats
  ).toBeUndefined();
  expect(
    (await anotherDevice.read("alice", "one")).preferences.messages
  ).toEqual(messages);
  expect(
    (await anotherDevice.read("bob", "one")).preferences.messages
  ).toBeUndefined();
  expect(
    (await anotherDevice.read("alice", "two")).preferences.messages
  ).toBeUndefined();
  expect((await anotherDevice.read("alice", "one")).preferences.agents).toEqual(
    agents
  );
  expect(
    (await anotherDevice.read("bob", "one")).preferences.agents
  ).toBeUndefined();
  expect((await anotherDevice.read("alice", "one")).preferences.people).toEqual(
    people
  );
  expect(
    (await anotherDevice.read("bob", "one")).preferences.people
  ).toBeUndefined();
  expect(
    (await anotherDevice.read("alice", "two")).preferences.people
  ).toBeUndefined();
});

it("checks membership at the write boundary for both first writes and later updates", async () => {
  const repository = createAccountSidebarRepository(createD1Db(harness.db));
  const initial = await repository.read("alice", "one");
  expect(await repository.save("alice", "one", initial)).toBe(true);
  harness.run({
    sql: "DELETE FROM members WHERE user_id = ?",
    params: ["alice"],
  });
  expect(await repository.save("alice", "two", initial)).toBe(false);
  expect(
    await repository.save("alice", "one", { ...initial, revision: 1 })
  ).toBe(false);
  expect(await repository.isMember("alice", "one")).toBe(false);
});
