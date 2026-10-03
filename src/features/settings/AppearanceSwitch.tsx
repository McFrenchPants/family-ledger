import { useState } from "react";

import { cx } from "../../components/ui/cx";
import { Segmented } from "../../components/ui/Segmented";
import type { ToggleOption } from "../../components/ui/Segmented";
import { getStoredTheme, setStoredTheme } from "../../lib/theme";
import type { ThemePreference, ThemeStorage } from "../../lib/theme";
import { ROW_CLASS, RowIcon } from "./SettingsParts";

const OPTIONS: ReadonlyArray<ToggleOption<ThemePreference>> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

/**
 * Light / Dark / Auto for this device. The choice applies at once (on
 * <html>) and is remembered through `setStoredTheme`; when the browser
 * blocks storage it still applies for this visit and we say it won't stick.
 *
 * `storage` is only for tests; the app uses theme.ts's default.
 */
export function AppearanceSwitch({ storage }: { storage?: ThemeStorage | null }) {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredTheme(storage));
  const [notSaved, setNotSaved] = useState(false);

  function choose(next: ThemePreference) {
    setPreference(next);
    setNotSaved(!setStoredTheme(next, storage));
  }

  return (
    <div className={cx(ROW_CLASS, "flex-wrap")}>
      <RowIcon name="sliders" />
      <span className="min-w-0 grow">Appearance</span>
      <Segmented
        label="Appearance"
        options={OPTIONS}
        value={preference}
        onValueChange={choose}
        className="basis-full min-[420px]:w-[216px] min-[420px]:basis-auto"
      />
      {notSaved && (
        <p role="status" className="basis-full pb-1 text-label text-muted">
          This device couldn&apos;t save your choice; it will reset next time.
        </p>
      )}
    </div>
  );
}
