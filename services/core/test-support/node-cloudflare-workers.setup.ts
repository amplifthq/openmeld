import { vi } from "vitest";

// Node boundary tests replace platform background-task registration. Workers
// integration tests use the native module and exercise request lifetime behavior.
vi.mock("cloudflare:workers", () => ({ waitUntil: vi.fn() }));
