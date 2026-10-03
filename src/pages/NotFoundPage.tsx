import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { LinkButton } from "../components/ui/LinkButton";

export function NotFoundPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-title">Page not found</h1>
      <Card>
        <EmptyState
          icon="alert"
          title="Nothing lives at this address"
          action={
            <LinkButton to="/home" variant="primary" size="md" icon="home">
              Back to dashboard
            </LinkButton>
          }
        >
          The link may be old or mistyped. Your ledger is safe and sound.
        </EmptyState>
      </Card>
    </section>
  );
}
