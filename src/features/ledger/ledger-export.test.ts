import { describe, expect, it } from "vitest";

import { escapeCsvField, toLedgerCsv, toLedgerExportTransactions } from "./ledger-export";

describe("toLedgerExportTransactions", () => {
  it("maps an active (non-voided) row, including embedded category and member name", () => {
    const result = toLedgerExportTransactions([
      {
        id: "tx-1",
        description: "Gas",
        amount_cents: 4217,
        type: "expense",
        occurred_on: "2026-09-04",
        voided_at: null,
        category: { name: "Transportation" },
        member: { name: "Alex" },
      },
    ]);

    expect(result).toEqual([
      {
        id: "tx-1",
        occurredOn: "2026-09-04",
        memberName: "Alex",
        type: "expense",
        amountCents: 4217,
        categoryName: "Transportation",
        description: "Gas",
        isVoided: false,
      },
    ]);
  });

  it("marks a voided row as voided", () => {
    const result = toLedgerExportTransactions([
      {
        id: "tx-2",
        description: "Movie tickets",
        amount_cents: 1500,
        type: "expense",
        occurred_on: "2026-09-01",
        voided_at: "2026-09-02T10:00:00Z",
        category: null,
        member: { name: "Alex" },
      },
    ]);

    expect(result[0]).toMatchObject({ isVoided: true });
  });

  it("falls back to a graceful placeholder member name when the embed is null", () => {
    const result = toLedgerExportTransactions([
      {
        id: "tx-3",
        description: "Allowance adjustment",
        amount_cents: -1000,
        type: "adjustment",
        occurred_on: "2026-09-01",
        voided_at: null,
        category: null,
        member: null,
      },
    ]);

    expect(result[0]?.memberName).toBe("someone");
  });

  it("returns an empty list for an empty result set", () => {
    expect(toLedgerExportTransactions([])).toEqual([]);
  });
});

describe("escapeCsvField", () => {
  it("leaves a plain field bare", () => {
    expect(escapeCsvField("Gas")).toBe("Gas");
  });

  it("quotes a field containing a comma", () => {
    expect(escapeCsvField("Groceries, snacks")).toBe('"Groceries, snacks"');
  });

  it("quotes and doubles internal double quotes", () => {
    expect(escapeCsvField('She said "hi"')).toBe('"She said ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a field containing a carriage return", () => {
    expect(escapeCsvField("line one\rline two")).toBe('"line one\rline two"');
  });

  it("leaves an empty string bare", () => {
    expect(escapeCsvField("")).toBe("");
  });
});

describe("toLedgerCsv", () => {
  it("emits a header row and formats money via formatCents, not raw cents", () => {
    const csv = toLedgerCsv([
      {
        id: "tx-1",
        occurredOn: "2026-09-04",
        memberName: "Alex",
        type: "expense",
        amountCents: 4217,
        categoryName: "Transportation",
        description: "Gas",
        isVoided: false,
      },
    ]);

    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Date,Member,Type,Amount,Category,Description,Voided");
    expect(lines[1]).toBe("2026-09-04,Alex,Expense,$42.17,Transportation,Gas,");
    // Trailing CRLF after the last data row, no stray blank rows in between.
    expect(lines[2]).toBe("");
    expect(lines).toHaveLength(3);
  });

  it("renders a voided row's Voided column and omits a null category", () => {
    const csv = toLedgerCsv([
      {
        id: "tx-2",
        occurredOn: "2026-09-01",
        memberName: "Alex",
        type: "payment",
        amountCents: -1500,
        categoryName: null,
        description: "Paid down balance",
        isVoided: true,
      },
    ]);

    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("2026-09-01,Alex,Payment,-$15.00,,Paid down balance,Voided");
  });

  it("escapes a description containing a comma, a quote, and a newline without corrupting row structure", () => {
    const csv = toLedgerCsv([
      {
        id: "tx-3",
        occurredOn: "2026-09-02",
        memberName: "Alex",
        type: "expense",
        amountCents: 100,
        categoryName: null,
        description: 'Snacks, "chips" and\nsoda',
        isVoided: false,
      },
      {
        id: "tx-4",
        occurredOn: "2026-09-03",
        memberName: "Sam",
        type: "expense",
        amountCents: 200,
        categoryName: null,
        description: "Second row",
        isVoided: false,
      },
    ]);

    const lines = csv.split("\r\n");
    // The embedded comma/quote/newline must not create extra columns or rows:
    // exactly header + 2 data rows + trailing empty string from the final CRLF.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("Date,Member,Type,Amount,Category,Description,Voided");
    expect(lines[3]).toBe("");

    // Round-trip check: split the escaped description field back out and
    // confirm it decodes to the original string, proving the comma/quote/
    // newline stayed inside one field rather than splitting the row.
    const descriptionField = '"Snacks, ""chips"" and\nsoda"';
    expect(csv).toContain(`2026-09-02,Alex,Expense,$1.00,,${descriptionField},`);
    expect(csv).toContain("2026-09-03,Sam,Expense,$2.00,,Second row,");
  });

  it("returns just the header row for an empty transaction list", () => {
    expect(toLedgerCsv([])).toBe("Date,Member,Type,Amount,Category,Description,Voided\r\n");
  });
});
