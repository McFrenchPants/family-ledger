// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { remindersFor, useMemberPushStatus } from "./useMemberPushStatus";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("../../lib/supabase", () => ({ supabase: { rpc: rpcMock } }));

beforeEach(() => {
  rpcMock.mockReset();
});

describe("useMemberPushStatus", () => {
  it("calls the push-status function for the household and maps rows by member", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { household_member_id: "m1", has_subscription: true },
        { household_member_id: "m2", has_subscription: false },
      ],
      error: null,
    });

    const { result } = renderHook(() => useMemberPushStatus("h1"));
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(rpcMock).toHaveBeenCalledWith("household_member_push_status", { p_household_id: "h1" });
    expect(remindersFor(result.current, "m1")).toBe(true);
    expect(remindersFor(result.current, "m2")).toBe(false);
    // A member the function did not answer for (e.g. archived) is unknown, not "off".
    expect(remindersFor(result.current, "m3")).toBeNull();
  });

  it("reports a function error and retries on request", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useMemberPushStatus("h1"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(remindersFor(result.current, "m1")).toBeNull();

    rpcMock.mockResolvedValueOnce({
      data: [{ household_member_id: "m1", has_subscription: true }],
      error: null,
    });
    const state = result.current;
    if (state.status !== "error") throw new Error("expected error state");
    act(() => state.retry());

    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(remindersFor(result.current, "m1")).toBe(true);
  });

  it("turns a thrown network failure into an error state", async () => {
    rpcMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMemberPushStatus("h1"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toMatch(/could not reach the ledger service: offline/i);
    }
  });

  it("ignores a late answer after unmount", async () => {
    let resolve: (value: unknown) => void = () => {};
    rpcMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result, unmount } = renderHook(() => useMemberPushStatus("h1"));
    unmount();
    resolve({ data: [{ household_member_id: "m1", has_subscription: true }], error: null });
    await Promise.resolve();
    expect(result.current.status).toBe("loading");
  });
});
