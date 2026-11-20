import { BarChart3, Building2, CalendarDays, CalendarRange, Calendar, Package, ShieldAlert, Users } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/context/AuthContext"
import { canManage } from "@/lib/permissions"
import { useActiveBusiness } from "@/hooks/useActiveBusiness"
import { EmptyState } from "@/components/EmptyState"
import { DailyReportTab } from "@/components/reports/DailyReportTab"
import { WeeklyReportTab } from "@/components/reports/WeeklyReportTab"
import { MonthlyReportTab } from "@/components/reports/MonthlyReportTab"
import { EmployeeReportTab } from "@/components/reports/EmployeeReportTab"
import { ProductReportTab } from "@/components/reports/ProductReportTab"
import { StockAlertsTab } from "@/components/reports/StockAlertsTab"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import "@/components/reports/reports.css"

/**
 * Reports page — manager-only analytics hub for the active business,
 * organized into six tabs, each a self-contained component that fetches
 * its own data and offers a CSV/PDF export (via `DownloadMenu` /
 * `lib/csv.ts` + `lib/pdf.ts`) of what's currently displayed:
 * - Daily / Weekly / Monthly (`DailyReportTab`, `WeeklyReportTab`,
 *   `MonthlyReportTab`): sales totals over the respective time window.
 * - Employees (`EmployeeReportTab`): sales performance broken down by team
 *   member.
 * - Products (`ProductReportTab`): sales/revenue broken down by product.
 * - Stock alerts (`StockAlertsTab`): low-stock and out-of-stock items,
 *   the same data source as the Dashboard's stock alert card.
 *
 * Access control: gated by the active-business role — employees never see
 * this page. Also requires an active business; both cases fall back to an
 * `EmptyState`. This page itself does no data fetching — each tab owns its
 * own query.
 */
export default function Reports() {
  const { t } = useTranslation()
  const { user, activeBusinessId } = useAuth()
  const activeBusiness = useActiveBusiness()

  if (!canManage(activeBusiness?.roleInBusiness ?? user?.role)) {
    return (
      <EmptyState
        icon={<BarChart3 className="size-6" />}
        title="Not available"
        description="Reports are only visible to owners and admins."
      />
    )
  }

  if (!activeBusinessId) {
    return (
      <EmptyState
        icon={<BarChart3 className="size-6" />}
        title="No business selected"
        description="Select or create a business to view reports."
      />
    )
  }

  return (
    <div className="reports-page">
      <header className="reports-heading"><div><p className="workspace-eyebrow">{t("BUSINESS PERFORMANCE")}</p><h1>{t("Reports")}</h1><p>{t("A clearer view of your sales, team and stock.")}</p></div><div className="reports-business"><Building2 size={19} /><div><strong>{activeBusiness?.name}</strong><small>{t("Reporting currency")} · {activeBusiness?.currency ?? "USD"}</small></div></div></header>
      <Tabs defaultValue="daily" key={activeBusinessId}>
        <TabsList className="reports-tabs" aria-label={t("Report views")}>
          <TabsTrigger value="daily"><CalendarDays />{t("Daily")}</TabsTrigger>
          <TabsTrigger value="weekly"><CalendarRange />{t("Weekly")}</TabsTrigger>
          <TabsTrigger value="monthly"><Calendar />{t("Monthly")}</TabsTrigger>
          <TabsTrigger value="employees"><Users />{t("Employees")}</TabsTrigger>
          <TabsTrigger value="products"><Package />{t("Products")}</TabsTrigger>
          <TabsTrigger value="stock"><ShieldAlert />{t("Stock alerts")}</TabsTrigger>
        </TabsList>

        <TabsContent value="daily">
          <DailyReportTab />
        </TabsContent>
        <TabsContent value="weekly">
          <WeeklyReportTab />
        </TabsContent>
        <TabsContent value="monthly">
          <MonthlyReportTab />
        </TabsContent>
        <TabsContent value="employees">
          <EmployeeReportTab />
        </TabsContent>
        <TabsContent value="products">
          <ProductReportTab />
        </TabsContent>
        <TabsContent value="stock">
          <StockAlertsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
