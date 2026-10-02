import { cx } from "./cx";

type AvatarProps = {
  name: string;
  size?: "sm" | "md";
  className?: string;
};

/** First-letter avatar. Decorative: the name is always shown beside it. */
export function Avatar({ name, size = "md", className }: AvatarProps) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent-text",
        size === "sm" ? "h-8 w-8 text-label" : "h-10 w-10 text-body",
        className,
      )}
    >
      {initial}
    </span>
  );
}
