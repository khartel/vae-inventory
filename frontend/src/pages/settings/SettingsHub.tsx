import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  ChevronRight,
  User,
  KeyRound,
  ShieldCheck,
  Receipt,
  Palette,
  History,
  ArchiveRestore,
  PackageX,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface SettingsCardProps {
  icon: LucideIcon
  title: string
  description: string
  onClick: () => void
}

/**
 * One clickable tile in the Settings hub grid — icon, title, short
 * description, and a chevron affordance. Translates `title`/`description`
 * itself (source-text-as-key convention), so the grid below just passes
 * plain English text.
 */
function SettingsCard({ icon: Icon, title, description, onClick }: SettingsCardProps) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-start gap-4 rounded-2xl border border-border/60 bg-card/60 p-5 text-left shadow-sm backdrop-blur-xl transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      )}
    >
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-success text-primary-foreground shadow-[0_0_16px_var(--glow-primary)]">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-heading text-base font-semibold">{t(title)}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t(description)}</p>
      </div>
      <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
    </button>
  )
}

/**
 * Settings hub (`/settings` index route) — a grid of cards, one per
 * settings section. Clicking a card navigates to that section's own page;
 * "Security" goes straight to the existing `/change-password` page rather
 * than an intermediate sub-page, since that's already a complete
 * standalone screen.
 */
export default function SettingsHub() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">{t("Settings")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Manage your account, security, and business preferences.")}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SettingsCard
          icon={User}
          title="Profile"
          description="Your name, phone number, and email"
          onClick={() => navigate("/settings/profile")}
        />
        <SettingsCard
          icon={KeyRound}
          title="Security"
          description="Update the password used to sign in."
          onClick={() => navigate("/change-password")}
        />
        <SettingsCard
          icon={ShieldCheck}
          title="Two-factor authentication"
          description="Require a code from an authenticator app when signing in."
          onClick={() => navigate("/settings/2fa")}
        />
        <SettingsCard
          icon={Receipt}
          title="Receipt appearance"
          description="Customize what prints on your receipts"
          onClick={() => navigate("/settings/receipt")}
        />
        <SettingsCard
          icon={PackageX}
          title="Stock alerts"
          description="Set when you're notified that a product is running low"
          onClick={() => navigate("/settings/stock-alerts")}
        />
        <SettingsCard
          icon={Palette}
          title="Appearance"
          description="Theme and display language"
          onClick={() => navigate("/settings/appearance")}
        />
        <SettingsCard
          icon={History}
          title="Activity log"
          description="Who deleted, added, or changed what"
          onClick={() => navigate("/settings/activity")}
        />
        <SettingsCard
          icon={ArchiveRestore}
          title="Trash"
          description="Restore deleted products, customers, and warehouses"
          onClick={() => navigate("/settings/trash")}
        />
      </div>
    </div>
  )
}
