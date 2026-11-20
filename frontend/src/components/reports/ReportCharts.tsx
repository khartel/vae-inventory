import { ArrowLeftRight, Banknote, BarChart3, CreditCard } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { PeriodSummary } from "@/services/report.service"
import { formatMoney } from "@/lib/format"
import { ReportPanel } from "./ReportLayout"

export function ReportSalesChart({ points, currency, title = "Daily breakdown", description }: { points: Array<{ key: string; label: string; amount: number; count: number }>; currency: string; title?: string; description?: string }) {
  const { t } = useTranslation()
  const max = Math.max(...points.map((point) => point.amount), 1)
  return <ReportPanel title={title} description={description} icon={BarChart3} className="report-trend-panel">
    <div className="report-chart-scroll"><div className={`report-chart ${points.length > 14 ? "report-chart-dense" : ""}`}>
      <div className="report-chart-scale" aria-hidden="true"><span>{formatMoney(max, currency)}</span><span>{formatMoney(max / 2, currency)}</span><span>0</span></div>
      <div className="report-chart-plot"><div className="report-chart-grid" aria-hidden="true" />{points.map((point, index) => <div key={point.key} className="report-chart-column"><div className="report-chart-bar" style={{ height: `${Math.max(0, point.amount / max * 100)}%` }} title={`${point.label}: ${formatMoney(point.amount, currency)}`} aria-hidden="true" /><span className="report-chart-tick" aria-hidden="true">{points.length <= 7 || index % Math.ceil(points.length / 7) === 0 || index === points.length - 1 ? point.label : ""}</span></div>)}</div>
    </div></div>
    <details className="report-chart-data"><summary>{t("View chart data")}</summary><div className="report-table-scroll"><table><caption className="sr-only">{t(title)}</caption><thead><tr><th>{t("Period")}</th><th>{t("Gross sales")}</th><th>{t("Transactions")}</th></tr></thead><tbody>{points.map((point) => <tr key={point.key}><td>{point.label}</td><td>{formatMoney(point.amount, currency)}</td><td>{point.count}</td></tr>)}</tbody></table></div></details>
  </ReportPanel>
}

export function ReportPaymentMix({ summary, currency }: { summary: PeriodSummary; currency: string }) {
  const { t } = useTranslation()
  const rows = [{ label: "Cash", amount: summary.cashTotal, icon: Banknote, tone: "cash" }, { label: "Transfer", amount: summary.transferTotal, icon: ArrowLeftRight, tone: "transfer" }, { label: "Credit sales", amount: Math.max(0, summary.totalAmount - summary.cashTotal - summary.transferTotal), icon: CreditCard, tone: "credit" }]
  return <ReportPanel title="Payment breakdown" description="How these sales were recorded" className="report-payment-panel">
    <p className="report-payment-total">{formatMoney(summary.totalAmount, currency)}<span>{t("Gross sales")}</span></p>
    <div className="report-payment-bar" aria-hidden="true">{rows.map((row) => <i key={row.label} className={`report-payment-${row.tone}`} style={{ width: `${summary.totalAmount > 0 ? row.amount / summary.totalAmount * 100 : 0}%` }} />)}</div>
    <dl className="report-payment-legend">{rows.map(({ icon: Icon, ...row }) => <div key={row.label}><dt><span className={`report-payment-icon report-payment-${row.tone}`}><Icon size={15} /></span>{t(row.label)}</dt><dd>{formatMoney(row.amount, currency)}</dd></div>)}</dl>
    <p className="report-payment-note">{t("Credit sales show sale value, not outstanding balances.")}</p>
  </ReportPanel>
}
