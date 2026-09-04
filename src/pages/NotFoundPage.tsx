import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title font-semibold">Page not found</h2>
      <Link
        to="/parent"
        className="inline-flex min-h-touch w-fit items-center rounded-card bg-accent px-4 text-body font-medium text-white"
      >
        Back to dashboard
      </Link>
    </section>
  );
}
