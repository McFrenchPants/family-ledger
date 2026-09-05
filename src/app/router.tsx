import { createBrowserRouter, Navigate } from "react-router-dom";

import { RootLayout } from "./RootLayout";
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
      { path: "parent", element: <ParentDashboardPage /> },
      { path: "child", element: <ChildDashboardPage /> },
      { path: "sign-in", element: <SignInPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
