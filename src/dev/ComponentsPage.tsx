import { useState } from "react";

import { AmountText } from "../components/ui/AmountText";
import { Avatar } from "../components/ui/Avatar";
import { Button, type ButtonVariant } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { ICON_NAMES } from "../components/ui/icon-paths";
import { InlineStatus } from "../components/ui/InlineStatus";
import { ProgressBar } from "../components/ui/ProgressBar";
import { ChipGroup, Segmented } from "../components/ui/Segmented";
import { Sheet, SheetClose } from "../components/ui/Sheet";
import { STATUS_KINDS, type StatusKind } from "../components/ui/status";
import { StatusChip } from "../components/ui/StatusChip";
import { getStoredTheme, setStoredTheme, type ThemePreference } from "../lib/theme";

/**
 * DEV-ONLY COMPONENT GALLERY. Registered in the router only when
 * import.meta.env.DEV is true and lazy-imported, so it is absent from the
 * production bundle. Throwaway: a place to eyeball every primitive and icon
 * in light and dark.
 */
export function ComponentsPage() {
  const [theme, setTheme] = useState<ThemePreference>(() => getStoredTheme());
  const [method, setMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [filters, setFilters] = useState<string[]>(["food"]);

  const variants: ButtonVariant[] = ["primary", "ok", "secondary", "ghost", "danger"];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <p className="text-caption uppercase text-subtle">Dev only</p>
        <h1 className="text-title">Dev-only component gallery</h1>
        <Segmented
          label="Theme"
          value={theme}
          onValueChange={(next) => {
            setStoredTheme(next);
            setTheme(next);
          }}
          options={[
            { value: "auto", label: "Auto" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </header>

      <Card as="section" className="flex flex-col gap-2">
        <h2 className="text-head">Type scale</h2>
        <p className="text-display">Display 40</p>
        <p className="text-amount">Amount 28</p>
        <p className="text-title">Title 22</p>
        <p className="text-head">Head 17</p>
        <p className="text-body">Body 16</p>
        <p className="text-label text-muted">Label 14 (muted)</p>
        <p className="text-caption text-subtle">Caption 12 (subtle)</p>
      </Card>

      <Card as="section" className="flex flex-col gap-3">
        <h2 className="text-head">Amounts</h2>
        <AmountText cents={18732} variant="hero" srContext="owed" />
        <div className="flex flex-col items-end gap-1">
          <AmountText cents={4217} kind="expense" />
          <AmountText cents={2500} kind="payment" />
          <AmountText cents={123456} />
          <AmountText cents={-500} tone="danger" />
        </div>
      </Card>

      <Card as="section" className="flex flex-col gap-3">
        <h2 className="text-head">Buttons</h2>
        {(["sm", "md", "lg"] as const).map((size) => (
          <div key={size} className="flex flex-wrap gap-2">
            {variants.map((variant) => (
              <Button key={variant} variant={variant} size={size}>
                {variant} {size}
              </Button>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon="plus">
            With icon
          </Button>
          <Button variant="primary" loading>
            Loading
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </div>
        <Button variant="ok" size="lg" fullWidth icon="dollar">
          Record payment
        </Button>
      </Card>

      <Card as="section" className="flex flex-col gap-3">
        <h2 className="text-head">Status chips</h2>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(STATUS_KINDS) as StatusKind[]).map((kind) => (
            <StatusChip key={kind} kind={kind} label={kind} />
          ))}
        </div>
      </Card>

      <Card as="section" className="flex flex-col gap-3">
        <h2 className="text-head">Progress</h2>
        <ProgressBar value={20} max={40} label="Accent progress" />
        <ProgressBar value={40} max={40} label="Ok progress" tone="ok" />
        <ProgressBar value={10} max={40} label="Warn progress" tone="warn" />
        <ProgressBar
          value={55}
          max={40}
          label="Danger progress (clamped)"
          tone="danger"
        />
      </Card>

      <Card as="section" className="flex flex-col gap-3">
        <h2 className="text-head">Inputs and toggles</h2>
        <Field label="Amount" hint="Dollars and cents, e.g. 12.34" inputMode="decimal" />
        <Field label="Note" error="That note is too long." defaultValue="Too long" />
        <Segmented
          label="Payment method"
          value={method}
          onValueChange={setMethod}
          options={[
            { value: "cash", label: "Cash" },
            { value: "card", label: "Card" },
            { value: "transfer", label: "Transfer" },
          ]}
        />
        <ChipGroup
          label="Categories"
          value={filters}
          onValueChange={setFilters}
          options={[
            { value: "food", label: "Food" },
            { value: "fuel", label: "Fuel" },
            { value: "phone", label: "Phone" },
          ]}
        />
      </Card>

      <Card as="section" className="flex flex-col gap-3">
        <h2 className="text-head">Avatar, status, sheet</h2>
        <div className="flex items-center gap-3">
          <Avatar name="Sam" />
          <Avatar name="riley" size="sm" />
          <span className="text-body">Sam and Riley</span>
        </div>
        <InlineStatus tone="info">Reminders are on.</InlineStatus>
        <InlineStatus tone="ok">Payment saved.</InlineStatus>
        <InlineStatus tone="warn">Due in 3 days.</InlineStatus>
        <InlineStatus tone="danger">Could not save. Try again.</InlineStatus>
        <Sheet
          title="Record payment"
          description="A bottom sheet on phones, a dialog on wide screens."
          trigger={<Button variant="primary">Open sheet</Button>}
        >
          <Field label="Amount" inputMode="decimal" />
          <SheetClose asChild>
            <Button variant="ok" fullWidth>
              Done
            </Button>
          </SheetClose>
        </Sheet>
      </Card>

      <Card as="section">
        <EmptyState
          icon="list"
          title="No transactions yet"
          action={<Button variant="primary">Add expense</Button>}
        >
          Expenses you add will show up here.
        </EmptyState>
      </Card>

      <Card as="section" className="flex flex-col gap-3">
        <h2 className="text-head">Icons ({ICON_NAMES.length})</h2>
        <ul className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {ICON_NAMES.map((name) => (
            <li
              key={name}
              className="flex flex-col items-center gap-1 text-caption text-muted"
            >
              <Icon name={name} size={24} className="text-ink" />
              {name}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
