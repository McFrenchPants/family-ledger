import { Button } from "./Button";

/**
 * The one way a failed read is shown: what went wrong, and a Retry that
 * refetches (never a queued replay).
 */
export function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-label text-danger">{message}</p>
      <Button size="sm" icon="undo" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
