import { Outlet } from "react-router-dom"
import "./workspace.css"
import { Sidebar } from "@/components/layout/Sidebar"
import { Topbar } from "@/components/layout/Topbar"

/**
 * Top-level authenticated layout: renders the decorative `AppBackground`,
 * the fixed `Sidebar` (desktop) and `Topbar` (which also hosts the mobile
 * nav sheet) side-by-side, and an `<Outlet />` for the current route's page
 * content in a scrollable main area. Used as the layout route element for
 * everything behind `ProtectedRoute`.
 */
export function AppLayout() {
  return (
    <div className="business-workspace relative flex h-svh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="workspace-main flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
