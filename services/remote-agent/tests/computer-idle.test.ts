import { afterEach, expect, it, vi } from "vitest";
import { ComputerIdleGuard } from "../flue-adapter/computer-idle";

afterEach(() => vi.useRealTimers());

it("waits for both concurrent operations and a full quiet period", async () => {
  vi.useFakeTimers();
  const idle = new ComputerIdleGuard();
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const a = idle.run(() => first.promise);
  const b = idle.run(() => second.promise);
  vi.advanceTimersByTime(3_600_000);
  expect(idle.canClose).toBe(false);
  first.resolve();
  await a;
  vi.advanceTimersByTime(3_600_000);
  expect(idle.canClose).toBe(false);
  second.resolve();
  await b;
  expect(idle.canClose).toBe(false);
  vi.advanceTimersByTime(120_000);
  expect(idle.canClose).toBe(true);
  idle.touch();
  expect(idle.canClose).toBe(false);
});

it("releases a failed operation without shortening the idle grace", async () => {
  vi.useFakeTimers();
  const idle = new ComputerIdleGuard();
  await expect(
    idle.run(() => Promise.reject(new Error("failed")))
  ).rejects.toThrow("failed");
  expect(idle.canClose).toBe(false);
  vi.advanceTimersByTime(120_000);
  expect(idle.canClose).toBe(true);
});
