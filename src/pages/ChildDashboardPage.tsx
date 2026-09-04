export function ChildDashboardPage() {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-title font-semibold">Child dashboard</h2>
        <p className="mt-1 text-body text-ink-muted">
          Placeholder. A child will see their own balance and be able to add an expense
          here; every balance-reducing action stays Parent-only and server-enforced.
        </p>
      </div>
    </section>
  );
}
