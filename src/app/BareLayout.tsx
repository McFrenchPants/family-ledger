import { Outlet } from "react-router-dom";

/**
 * Frame for the pages a person sees before they are signed in (`/sign-in`,
 * `/set-password`): just a centred column, no navigation or app chrome.
 */
export function BareLayout() {
  return (
    <div className="min-h-[100dvh] bg-bg text-ink">
      <main id="main" className="mx-auto w-full max-w-[640px] px-gutter py-8">
        <Outlet />
      </main>
    </div>
  );
}
