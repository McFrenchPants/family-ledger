// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AmountText, MINUS } from "./AmountText";
import { Button } from "./Button";
import { Field } from "./Field";
import { Icon } from "./Icon";
import { ICON_NAMES, ICON_PATHS } from "./icon-paths";
import { InlineStatus } from "./InlineStatus";
import { spokenAmount, splitFraction } from "./money-speech";
import { clampProgress } from "./progress";
import { ProgressBar } from "./ProgressBar";
import { Segmented } from "./Segmented";
import { Sheet } from "./Sheet";
import { STATUS_KINDS, type StatusKind } from "./status";
import { StatusChip } from "./StatusChip";

describe("spokenAmount", () => {
  it.each([
    [18732, "187 dollars and 32 cents"],
    [100, "1 dollar"],
    [101, "1 dollar and 1 cent"],
    [5, "5 cents"],
    [0, "0 dollars"],
    [-2500, "minus 25 dollars"],
    [123456789, "1234567 dollars and 89 cents"],
  ])("%i -> %s", (cents, expected) => {
    expect(spokenAmount(cents)).toBe(expected);
  });

  it("rejects non-integer cents", () => {
    expect(() => spokenAmount(1.5)).toThrow(TypeError);
  });
});

describe("splitFraction", () => {
  it("splits a prefix-symbol amount", () => {
    expect(splitFraction("$187.32")).toEqual(["$187", ".32"]);
    expect(splitFraction("$1,234.00")).toEqual(["$1,234", ".00"]);
  });
  it("keeps a trailing currency symbol in the main part", () => {
    expect(splitFraction("187,32 $")).toEqual(["187 $", ",32"]);
  });
  it("leaves unrecognised input whole", () => {
    expect(splitFraction("n/a")).toEqual(["n/a", ""]);
  });
});

describe("AmountText", () => {
  it("formats a list amount through formatCents, tabular, with a spoken label", () => {
    render(<AmountText cents={4217} locale="en-US" />);
    const amount = screen.getByRole("img", { name: "42 dollars and 17 cents" });
    expect(amount).toHaveTextContent("$42.17");
    expect(amount.className).toContain("tabular-nums");
  });

  it("renders the hero variant with small cents and caller context", () => {
    render(<AmountText cents={18732} variant="hero" srContext="owed" locale="en-US" />);
    const amount = screen.getByRole("img", { name: "187 dollars and 32 cents owed" });
    expect(amount).toHaveTextContent("$187.32");
    expect(screen.getByText(".32").tagName).toBe("SPAN");
    expect(amount.className).toContain("text-display");
  });

  it("shows payments with a true minus in the ok colour", () => {
    render(<AmountText cents={2500} kind="payment" locale="en-US" />);
    const amount = screen.getByRole("img", { name: "minus 25 dollars" });
    expect(amount).toHaveTextContent(`${MINUS}$25.00`);
    expect(amount.textContent).not.toContain("-");
    expect(amount.className).toContain("text-ok");
  });

  it("shows expenses with a plus in ink", () => {
    render(<AmountText cents={4217} kind="expense" locale="en-US" />);
    const amount = screen.getByRole("img", { name: "plus 42 dollars and 17 cents" });
    expect(amount).toHaveTextContent("+$42.17");
    expect(amount.className).toContain("text-ink");
  });

  it("uses a true minus for a plain negative amount", () => {
    render(<AmountText cents={-500} locale="en-US" />);
    expect(screen.getByRole("img", { name: "minus 5 dollars" })).toHaveTextContent(
      `${MINUS}$5.00`,
    );
  });

  it("has no sign by default", () => {
    render(<AmountText cents={500} locale="en-US" />);
    expect(screen.getByRole("img").textContent).toBe("$5.00");
  });

  it("refuses non-integer cents", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<AmountText cents={42.17} />)).toThrow(TypeError);
    expect(() => render(<AmountText cents={Number.NaN} />)).toThrow(TypeError);
    spy.mockRestore();
  });
});

describe("StatusChip", () => {
  const kinds = Object.keys(STATUS_KINDS) as StatusKind[];

  it.each(kinds)("%s shows its icon and the caller's text", (kind) => {
    const { container } = render(<StatusChip kind={kind} label={`Label for ${kind}`} />);
    expect(screen.getByText(`Label for ${kind}`)).toBeVisible();
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("data-icon")).toBe(STATUS_KINDS[kind].icon);
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("maps the spec's status vocabulary", () => {
    expect(STATUS_KINDS.overdue).toEqual({ icon: "alert", tone: "danger" });
    expect(STATUS_KINDS.due).toEqual({ icon: "clock", tone: "warn" });
    expect(STATUS_KINDS.partial).toEqual({ icon: "half", tone: "info" });
    expect(STATUS_KINDS.satisfied).toEqual({ icon: "checkc", tone: "ok" });
    expect(STATUS_KINDS.clear).toEqual({ icon: "checkc", tone: "ok" });
    expect(STATUS_KINDS.upcoming.tone).toBe("neutral");
    expect(STATUS_KINDS.waived.icon).toBe("dash");
    expect(STATUS_KINDS.none.icon).toBe("dash");
  });
});

describe("ProgressBar", () => {
  it("exposes progressbar semantics with a name and values", () => {
    render(
      <ProgressBar value={20} max={40} label="Paid this month" valueText="$20 of $40" />,
    );
    const bar = screen.getByRole("progressbar", { name: "Paid this month" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "40");
    expect(bar).toHaveAttribute("aria-valuenow", "20");
    expect(bar).toHaveAttribute("aria-valuetext", "$20 of $40");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("50%");
  });

  it("clamps values above max and below zero", () => {
    const { rerender } = render(<ProgressBar value={150} label="Progress" />);
    const bar = screen.getByRole("progressbar", { name: "Progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%");
    rerender(<ProgressBar value={-5} label="Progress" />);
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("0%");
  });

  it("handles NaN, infinite and non-positive bounds", () => {
    expect(clampProgress(Number.NaN, 10)).toEqual({ value: 0, max: 10 });
    expect(clampProgress(Number.POSITIVE_INFINITY, 10)).toEqual({ value: 0, max: 10 });
    expect(clampProgress(5, 0)).toEqual({ value: 1, max: 1 });
    expect(clampProgress(5, -3)).toEqual({ value: 1, max: 1 });
    expect(clampProgress(0, 0)).toEqual({ value: 0, max: 1 });
  });
});

describe("Icon", () => {
  it("has the full spec icon set", () => {
    expect(ICON_NAMES).toHaveLength(36);
    for (const name of ICON_NAMES) expect(ICON_PATHS[name]).toMatch(/^M/);
  });

  it("is decorative by default and labelled when asked", () => {
    const { container } = render(
      <>
        <Icon name="home" />
        <Icon name="bell" label="Reminders" />
      </>,
    );
    const [decorative] = container.querySelectorAll("svg");
    expect(decorative).toHaveAttribute("aria-hidden", "true");
    expect(decorative).toHaveAttribute("stroke", "currentColor");
    expect(decorative).toHaveAttribute("fill", "none");
    expect(screen.getByRole("img", { name: "Reminders" })).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("defaults to type=button and disables while loading", () => {
    render(
      <Button variant="primary" loading>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.className).toContain("text-on-accent");
  });

  it("uses the on-token for each filled variant", () => {
    render(
      <>
        <Button variant="ok">Pay</Button>
        <Button variant="danger">Void</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Pay" }).className).toContain("text-on-ok");
    expect(screen.getByRole("button", { name: "Void" }).className).toContain(
      "text-on-danger",
    );
  });
});

describe("Field", () => {
  it("wires label, hint and error to the input", () => {
    render(<Field label="Amount" hint="Dollars and cents" error="Enter an amount." />);
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Dollars and cents Enter an amount.");
    expect(input.className).toContain("text-body");
  });

  it("has no description or invalid flag when there is nothing to say", () => {
    render(<Field label="Note" />);
    const input = screen.getByLabelText("Note");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});

describe("InlineStatus", () => {
  it("is a polite live region with an icon", () => {
    const { container } = render(<InlineStatus tone="ok">Payment saved.</InlineStatus>);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Payment saved.");
    expect(container.querySelector("svg[data-icon='checkc']")).not.toBeNull();
  });
});

describe("Segmented", () => {
  function Harness() {
    const [value, setValue] = useState<"cash" | "card">("cash");
    return (
      <>
        <Segmented
          label="Method"
          value={value}
          onValueChange={setValue}
          options={[
            { value: "cash", label: "Cash" },
            { value: "card", label: "Card" },
          ]}
        />
        <p>selected: {value}</p>
      </>
    );
  }

  it("selects one option and never clears to nothing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: "Card" }));
    expect(screen.getByText("selected: card")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Card" }));
    expect(screen.getByText("selected: card")).toBeInTheDocument();
  });
});

describe("Sheet", () => {
  it("opens from its trigger as a labelled dialog and closes", async () => {
    const user = userEvent.setup();
    render(
      <Sheet
        title="Record payment"
        description="Money received"
        trigger={<button>Open</button>}
      >
        <p>sheet body</p>
      </Sheet>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Record payment" });
    expect(dialog).toHaveAccessibleDescription("Money received");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
