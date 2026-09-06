import { createBrowserRouter, Navigate } from "react-router-dom";

import { RootLayout } from "./RootLayout";
import { RequireRole } from "../features/auth/RequireRole";
import { AddExpensePage } from "../pages/AddExpensePage";
import { ChildDashboardPage } from "../pages/ChildDashboardPage";
import { ExportPage } from "../pages/ExportPage";
import { HistoryPage } from "../pages/HistoryPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ParentDashboardPage } from "../pages/ParentDashboardPage";
import { PaymentPlanPage } from "../pages/PaymentPlanPage";
import { RecordPaymentPage } from "../pages/RecordPaymentPage";
import { SignInPage } from "../pages/SignInPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/parent" replace /> },
      {
        path: "parent",
        element: (
          <RequireRole role="parent">
            <ParentDashboardPage />
          </RequireRole>
        ),
      },
      {
        path: "child",
        element: (
          <RequireRole role="child">
            <ChildDashboardPage />
          </RequireRole>
        ),
      },
      { path: "add-expense", element: <AddExpensePage /> },
      { path: "record-payment", element: <RecordPaymentPage /> },
      {
        path: "export",
        element: (
          <RequireRole role="parent">
            <ExportPage />
          </RequireRole>
        ),
      },
      { path: "child/:memberId/history", element: <HistoryPage /> },
      { path: "child/:memberId/payment-plan", element: <PaymentPlanPage /> },
      { path: "sign-in", element: <SignInPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
