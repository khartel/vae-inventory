import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Skeleton } from "@/components/ui/skeleton"
import "./operations.css"

interface OperationsSummaryProps {
  loading: boolean
  items: Array<{ label: string; value: ReactNode; description: string }>
}

/** Compact, shared summary strip for inventory operations pages. */
export function OperationsSummary({ loading, items }: OperationsSummaryProps) {
  const { t } = useTranslation()

  return (
    <dl className="operations-summary" aria-busy={loading}>
      {items.map((item) => (
        <div key={item.label} className="operations-stat">
          <dt>{t(item.label)}</dt>
          <dd>
            {loading ? <Skeleton className="my-2 h-7 w-20" /> : <span className="operations-stat-value">{item.value}</span>}
            <span className="operations-stat-description">{t(item.description)}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}
