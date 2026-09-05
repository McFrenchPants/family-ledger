import { createBrowserRouter, Navigate } from "react-router-dom";

import { RootLayout } from "./RootLayout";
import { RequireRole } from "../features/auth/RequireRole";
import { ChildDashboardPage } from "../pages/ChildDashboardPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ParentDashboardPage } from "../pages/ParentDashboardPage";
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
      { path: "sign-in", element: <SignInPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
