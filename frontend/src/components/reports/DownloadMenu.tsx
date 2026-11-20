import { Fragment } from "react"
import { Download } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// A group of related download options shown together in the menu, e.g. all the
// export formats for one report variant ("Items sold" -> CSV / PDF).
export interface DownloadMenuGroup {
  label?: string
  items: Array<{ label: string; onClick: () => void }>
}

/**
 * Generic "Download" dropdown button used by every report tab. It is presentation-only:
 * it just renders a button that opens a menu of `groups`, each with a set of clickable
 * `items` (typically "CSV" and "PDF"), and calls the matching item's `onClick` when
 * chosen. The actual export/generation logic (building CSV rows or a PDF document)
 * lives in the calling report tab, via `@/lib/csv`'s `downloadCsv` and `@/lib/pdf`'s
 * `downloadPdfReport`:
 * - `downloadCsv` serializes rows to a CSV string, wraps it in a Blob, and triggers a
 *   browser download via a temporary anchor element.
 * - `downloadPdfReport` uses jsPDF + jspdf-autotable to draw a business-branded header
 *   (name, location, report title, date range) followed by one or more table
 *   "sections" (each with an optional heading, head/body/foot rows), then saves the
 *   PDF client-side.
 *
 * Props:
 * - groups: the menu's sections/items (see DownloadMenuGroup).
 * - disabled: disables the trigger button (e.g. while report data hasn't loaded yet).
 * - className: passed through to the trigger button for layout (e.g. `ml-auto`).
 */
export function DownloadMenu({
  groups,
  disabled,
  className,
}: {
  groups: DownloadMenuGroup[]
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className={className}>
          <Download className="size-3.5" />
          {t("Download")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {groups.map((group, i) => (
          <Fragment key={group.label ?? i}>
            {i > 0 && <DropdownMenuSeparator />}
            {group.label && <DropdownMenuLabel>{t(group.label)}</DropdownMenuLabel>}
            {group.items.map((item) => (
              <DropdownMenuItem key={item.label} onClick={() => {
                try { item.onClick() } catch (error) {
                  console.error("Report export failed", error)
                  toast.error(t("Could not download report. Please try again."))
                }
              }}>
                {t(item.label)}
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
