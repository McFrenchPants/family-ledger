// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExportPage } from "./ExportPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import type { HouseholdBackupState } from "../features/backup/useHouseholdBackup";
import type { LedgerExportState } from "../features/ledger/useLedgerExport";

const exportState = vi.hoisted(() => ({ current: { status: "loading" } as unknown }));
const backupState = vi.hoisted(() => ({ current: { status: "loading" } as unknown }));

vi.mock("../features/ledger/useLedgerExport", () => ({
  useLedgerExport: () => exportState.current,
}));
vi.mock("../features/backup/useHouseholdBackup", () => ({
  useHouseholdBackup: () => backupState.current,
}));

const loadedParent: MembershipState = {
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role: "parent", name: "Alex", status: "active" },
};

function renderPage() {
  return render(
    <MembershipContext.Provider value={loadedParent}>
      <MemoryRouter>
        <ExportPage />
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

beforeEach(() => {
  exportState.current = { status: "loading" } satisfies LedgerExportState;
  backupState.current = { status: "loading" } satisfies HouseholdBackupState;
});

describe("ExportPage", () => {
  it("has one page heading and a back arrow to Settings", () => {
    renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Export & backup" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByText("Loading transactions…")).toBeInTheDocument();
    expect(screen.getByText("Preparing backup…")).toBeInTheDocument();
  });

  it("keeps each load error with its own retry", async () => {
    const user = userEvent.setup();
    const retryExport = vi.fn();
    const retryBackup = vi.fn();
    exportState.current = { status: "error", message: "boom", retry: retryExport };
    backupState.current = { status: "error", message: "bang", retry: retryBackup };
    renderPage();

    const alerts = screen.getAllByRole("alert");
    expect(alerts[0]).toHaveTextContent("Could not load transactions: boom");
    expect(alerts[1]).toHaveTextContent("Could not prepare backup: bang");

    const [first, second] = screen.getAllByRole("button", { name: "Retry" });
    await user.click(first!);
    await user.click(second!);
    expect(retryExport).toHaveBeenCalledTimes(1);
    expect(retryBackup).toHaveBeenCalledTimes(1);
  });

  it("disables the CSV download when there is nothing to export", () => {
    exportState.current = {
      status: "loaded",
      transactions: [],
      timezone: "America/New_York",
      refetch: vi.fn(),
    } as unknown as LedgerExportState;
    renderPage();
    expect(screen.getByText("No transactions to export yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  });
});
