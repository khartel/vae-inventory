import type { ReactNode } from "react"
import { ArrowLeftRight, Banknote, CalendarDays, CircleDollarSign, Info, Package, ReceiptText, TrendingUp, Trophy, Users, Wallet, type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { DailyBreakdownEntry, EmployeeBreakdown, PeriodSummary, ProductBreakdown } from "@/services/report.service"
import { formatMoney } from "@/lib/format"
import { averageDailySales } from "./report-data"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function ReportToolbar({ title, period, children, actions }: { title: string; period?: string; children: ReactNode; actions: ReactNode }) {
  const { t } = useTranslation()
  return <div className="report-toolbar">
    <div className="report-toolbar-heading"><span className="report-section-icon"><CalendarDays size={18} /></span><div><h2>{t(title)}</h2>{period && <p>{period}</p>}</div></div>
    <div className="report-filters">{children}</div><div className="report-export">{actions}</div>
  </div>
}

export function ReportDateField({ label, value, onChange, month }: { label: string; value: string; onChange: (value: string) => void; month?: boolean }) {
  const { t } = useTranslation()
  return <label className="report-date-field"><span>{t(label)}</span><Input type={month ? "month" : "date"} value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

export function ReportPanel({ title, description, children, className, icon: Icon }: { title: string; description?: string; children: ReactNode; className?: string; icon?: LucideIcon }) {
  const { t } = useTranslation()
  return <section className={cn("report-panel", className)}><header className="report-panel-heading"><div><h3>{Icon && <Icon size={16} aria-hidden="true" />}{t(title)}</h3>{description && <p>{t(description)}</p>}</div></header>{children}</section>
}

export function ReportMetric({ label, value, note, icon: Icon = CircleDollarSign, tone }: { label: string; value: string | number; note?: string; icon?: LucideIcon; tone?: "primary" | "warning" | "danger" }) {
  const { t } = useTranslation()
  return <div className={cn("report-metric", tone && `report-metric-${tone}`)}><div className="report-metric-label"><span>{t(label)}</span><Icon size={16} aria-hidden="true" /></div><strong>{value}</strong>{note && <small>{t(note)}</small>}</div>
}

export function ReportMetrics({ summary, currency, days }: { summary: PeriodSummary; currency: string; days?: DailyBreakdownEntry[] }) {
  return <div className="report-metrics">
    <ReportMetric label="Gross sales" value={formatMoney(summary.totalAmount, currency)} note="Before returns · includes credit sales" icon={TrendingUp} tone="primary" />
    <ReportMetric label="Transactions" value={summary.totalTransactions} note="Sales recorded" icon={ReceiptText} />
    {days ? <><ReportMetric label="Avg / day" value={formatMoney(averageDailySales(summary, days), currency)} note="Across the calendar period" icon={CalendarDays} /><ReportMetric label="Best day" value={summary.bestDay ? new Date(`${summary.bestDay.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) : "—"} note="Highest gross sales" icon={Trophy} /></> : <><ReportMetric label="Cash" value={formatMoney(summary.cashTotal, currency)} note="Cash sales" icon={Banknote} /><ReportMetric label="Transfer" value={formatMoney(summary.transferTotal, currency)} note="Transfer sales" icon={ArrowLeftRight} /></>}
    <ReportMetric label="Profit" value={formatMoney(summary.totalProfit, currency)} note={summary.hasIncompleteCostData ? "Incomplete cost data" : "From recorded product costs"} icon={Wallet} />
  </div>
}

export function ReportProfitNote({ incomplete }: { incomplete: boolean }) {
  const { t } = useTranslation()
  return incomplete ? <p className="report-notice"><Info size={16} aria-hidden="true" />{t("Profit is incomplete because some sold products have no recorded cost price.")}</p> : null
}

export function ReportBreakdowns({ employees, products, currency }: { employees: EmployeeBreakdown[]; products: ProductBreakdown[]; currency: string }) {
  const { t } = useTranslation()
  const rankedEmployees = [...employees].sort((a, b) => b.totalAmount - a.totalAmount)
  const rankedProducts = [...products].sort((a, b) => b.totalRevenue - a.totalRevenue)
  const employeeMax = Math.max(...rankedEmployees.map((row) => row.totalAmount), 1)
  const productMax = Math.max(...rankedProducts.map((row) => row.totalRevenue), 1)
  return <div className="report-columns">
    <ReportPanel title="By employee" description="Contribution to gross sales" icon={Users}><ol className="report-rankings">{rankedEmployees.map((row, index) => <li key={row.employee.id}><span className="report-rank">{String(index + 1).padStart(2, "0")}</span><div className="report-rank-content"><div><span>{row.employee.fullName}</span><strong>{formatMoney(row.totalAmount, currency)}</strong></div><div className="report-progress" aria-hidden="true"><i style={{ width: `${Math.max(0, row.totalAmount / employeeMax * 100)}%` }} /></div><small>{t("{{count}} transactions", { count: row.transactionCount })}</small></div></li>)}</ol></ReportPanel>
    <ReportPanel title="By product" description="Revenue and quantities sold" icon={Package}><ol className="report-rankings">{rankedProducts.map((row, index) => <li key={row.product.id}><span className="report-rank">{String(index + 1).padStart(2, "0")}</span><div className="report-rank-content"><div><span>{row.product.name}</span><strong>{formatMoney(row.totalRevenue, currency)}</strong></div><div className="report-progress" aria-hidden="true"><i style={{ width: `${Math.max(0, row.totalRevenue / productMax * 100)}%` }} /></div><small>{row.totalQuantity} {row.product.unit} <span>· {t("Profit")}: {formatMoney(row.totalProfit, currency)}{row.hasIncompleteCostData && ` · ${t("Incomplete cost data")}`}</span></small></div></li>)}</ol></ReportPanel>
  </div>
}
