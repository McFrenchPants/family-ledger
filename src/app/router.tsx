import { createBrowserRouter, Navigate } from "react-router-dom";

import { RootLayout } from "./RootLayout";
import { ChildDashboardPage } from "../pages/ChildDashboardPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ParentDashboardPage } from "../pages/ParentDashboardPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/parent" replace /> },
      { path: "parent", element: <ParentDashboardPage /> },
      { path: "child", element: <ChildDashboardPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
