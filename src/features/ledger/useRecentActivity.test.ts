// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHouseholdRecentActivity } from "./useHouseholdRecentActivity";
import { useRecentActivity } from "./useRecentActivity";

// A stand-in for the PostgREST query builder: records every call in order
// and resolves to an empty result at `.returns()`.
const { calls, fromMock } = vi.hoisted(() => {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.returns = () => Promise.resolve({ data: [], error: null });
  const fromMock = (table: string) => {
    calls.push(["from", table]);
    return builder;
  };
  return { calls, fromMock };
});

vi.mock("../../lib/supabase", () => ({ supabase: { from: fromMock } }));

const voidedFilter = () => calls.filter(([method]) => method === "is");

beforeEach(() => {
  calls.length = 0;
});

describe("recent-activity hooks and voided rows", () => {
  it("a member's list keeps voided rows by default (Family member page)", async () => {
    const { result } = renderHook(() => useRecentActivity("m1"));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(calls).toContainEqual(["eq", "member_id", "m1"]);
    expect(voidedFilter()).toEqual([]);
  });

  it("a member's list can leave voided rows out in the query (Child Home)", async () => {
    const { result } = renderHook(() => useRecentActivity("m1", { excludeVoided: true }));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(voidedFilter()).toEqual([["is", "voided_at", null]]);
    // Filtered before the limit, so the list still fills to its usual count.
    const methods = calls.map(([method]) => method);
    expect(methods.indexOf("is")).toBeLessThan(methods.indexOf("limit"));
  });

  it("Parent Home's household list always leaves voided rows out in the query", async () => {
    const { result } = renderHook(() => useHouseholdRecentActivity("h1"));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(calls).toContainEqual(["eq", "household_id", "h1"]);
    expect(voidedFilter()).toEqual([["is", "voided_at", null]]);
    const methods = calls.map(([method]) => method);
    expect(methods.indexOf("is")).toBeLessThan(methods.indexOf("limit"));
  });
});
