import { createBrowserRouter } from "react-router-dom";
import type { RouteObject } from "react-router-dom";

import { AppShell } from "./AppShell";
import { BareLayout } from "./BareLayout";
import {
  LegacyChildHistoryRedirect,
  LegacyPaymentPlanRoute,
  LegacyRedirect,
} from "./redirects";
import { RequireRole } from "../features/auth/RequireRole";
import { RoleHomeRedirect } from "../features/auth/RoleHomeRedirect";
import { AccountPage } from "../pages/AccountPage";
import { ActivityPage } from "../pages/ActivityPage";
import { AddExpensePage } from "../pages/AddExpensePage";
import { ExportPage } from "../pages/ExportPage";
import { HomePage } from "../pages/HomePage";
import { ManageCategoriesPage } from "../pages/ManageCategoriesPage";
import { ManageMembersPage } from "../pages/ManageMembersPage";
import { ManagePresetsPage } from "../pages/ManagePresetsPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PaymentPlanPage } from "../pages/PaymentPlanPage";
import { RecordPaymentPage } from "../pages/RecordPaymentPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SetPasswordPage } from "../pages/SetPasswordPage";
import { SignInPage } from "../pages/SignInPage";

/**
 * Exported (not just the router) so tests can mount the real route table in
 * a memory router.
 *
 * `RequireRole` on a route is routing convenience: authorization lives in
 * Postgres RLS and security-definer functions, and Parent-only pages keep
 * their own role checks as well.
 */
export const routes: RouteObject[] = [
  // Dev-only component gallery, outside the authenticated layout. The
  // import.meta.env.DEV guard is statically false in a production build, so
  // the branch and its lazy chunk are dropped from dist/ entirely.
  ...(import.meta.env.DEV
    ? [
        {
          path: "dev/components",
          lazy: async () => ({
            Component: (await import("../dev/ComponentsPage")).ComponentsPage,
          }),
        },
      ]
    : []),

  // Signed-out pages: no app chrome, and never redirected (`/set-password`
  // carries its link token in the URL fragment).
  {
    element: <BareLayout />,
    children: [
      { path: "/sign-in", element: <SignInPage /> },
      { path: "/set-password", element: <SetPasswordPage /> },
    ],
  },

  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <RoleHomeRedirect /> },
      { path: "home", element: <HomePage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "new/expense", element: <AddExpensePage /> },
      {
        path: "new/payment",
        element: (
          <RequireRole role="parent">
            <RecordPaymentPage />
          </RequireRole>
        ),
      },
      {
        path: "family",
        element: (
          <RequireRole role="parent">
            <ManageMembersPage />
          </RequireRole>
        ),
      },
      {
        path: "family/:memberId",
        element: (
          <RequireRole role="parent">
            <PaymentPlanPage />
          </RequireRole>
        ),
      },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/account", element: <AccountPage /> },
      {
        path: "settings/export",
        element: (
          <RequireRole role="parent">
            <ExportPage />
          </RequireRole>
        ),
      },
      {
        path: "settings/categories",
        element: (
          <RequireRole role="parent">
            <ManageCategoriesPage />
          </RequireRole>
        ),
      },
      {
        path: "settings/presets",
        element: (
          <RequireRole role="parent">
            <ManagePresetsPage />
          </RequireRole>
        ),
      },

      // Old addresses (bookmarks, installed-app links from before the
      // redesign). Each replaces history and keeps the query string.
      { path: "parent", element: <LegacyRedirect to="/home" /> },
      { path: "child", element: <LegacyRedirect to="/home" /> },
      { path: "add-expense", element: <LegacyRedirect to="/new/expense" /> },
      { path: "record-payment", element: <LegacyRedirect to="/new/payment" /> },
      { path: "members", element: <LegacyRedirect to="/family" /> },
      { path: "account", element: <LegacyRedirect to="/settings/account" /> },
      { path: "export", element: <LegacyRedirect to="/settings/export" /> },
      { path: "parent/categories", element: <LegacyRedirect to="/settings/categories" /> },
      { path: "parent/presets", element: <LegacyRedirect to="/settings/presets" /> },
      { path: "child/:memberId/history", element: <LegacyChildHistoryRedirect /> },
      // A Parent is sent on to /family/:memberId; a Child keeps the old
      // address (see LegacyPaymentPlanRoute).
      { path: "child/:memberId/payment-plan", element: <LegacyPaymentPlanRoute /> },

      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
