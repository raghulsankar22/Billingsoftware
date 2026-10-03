import { describe, expect, it, vi } from "vitest";
import { recordBillOutcome } from "./bill-outcomes";

describe("bill outcome recording", () => {
  it("retries a transient Supabase error and records the outcome after recovery", async () => {
    const write = vi.fn<() => PromiseLike<{ error: unknown | null; data?: unknown }>>()
      .mockResolvedValueOnce({ error: { message: "temporary database failure" } })
      .mockResolvedValueOnce({ error: null, data: { id: "bill-1" } });

    await expect(recordBillOutcome(write)).resolves.toEqual({ recorded: true });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("returns the database error when the outcome cannot be recorded after retry", async () => {
    const write = vi.fn<() => PromiseLike<{ error: unknown | null; data?: unknown }>>()
      .mockResolvedValue({ error: { message: "permission denied" } });

    await expect(recordBillOutcome(write)).resolves.toEqual({ recorded: false, error: "permission denied" });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("surfaces thrown write failures and recovers on the retry", async () => {
    const write = vi.fn<() => PromiseLike<{ error: unknown | null; data?: unknown }>>()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({ error: null, data: { id: "bill-1" } });

    await expect(recordBillOutcome(write)).resolves.toEqual({ recorded: true });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("reports a missing bill row instead of claiming the outcome was saved", async () => {
    const write = vi.fn<() => PromiseLike<{ error: unknown | null; data?: unknown }>>()
      .mockResolvedValue({ error: null, data: null });

    await expect(recordBillOutcome(write)).resolves.toEqual({ recorded: false, error: "No bill row was updated." });
    expect(write).toHaveBeenCalledTimes(2);
  });
});
