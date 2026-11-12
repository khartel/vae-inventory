import type { ReactNode } from "react"
import { ArrowRight, Boxes, ChartNoAxesCombined, Package, ShoppingCart } from "lucide-react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { ThemeToggle } from "@/components/ThemeToggle"
import "./login.css"

interface LoginShellProps {
  title: string
  description: string
  children: ReactNode
  showRegistration?: boolean
}

const features = [
  { icon: Package, title: "Track", description: "Know your stock" },
  { icon: ShoppingCart, title: "Manage", description: "Simplify your sales" },
  { icon: ChartNoAxesCombined, title: "Grow", description: "See the bigger picture" },
]

/** Login-only presentation; the shared shell for other auth routes stays independent. */
export function LoginShell({ title, description, children, showRegistration = false }: LoginShellProps) {
  const { t } = useTranslation()

  return (
    <div className="login-landing">
      <div className="login-mobile-art" aria-hidden="true" />
      <header className="login-nav">
        <Link to="/login" className="login-brand" aria-label="VAE Inventory">
          <span className="login-mark"><Boxes aria-hidden="true" /></span>
          <span>VAE Inventory</span>
        </Link>
        <div className="login-nav-actions">
          <div className="login-nav-signup">
            <span>{t("New to VAE Inventory?")}</span>
            <Link to="/register">{t("Create an account")}<ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="login-content">
        <section className="login-story" aria-labelledby="login-hero-title">
          <p className="login-eyebrow">{t("Your business. In control.")}</p>
          <h1 id="login-hero-title">{t("Run your inventory")}<br /><span>{t("with clarity.")}</span></h1>
          <p className="login-intro">{t("Manage your stock, sales, and everyday business operations in one connected workspace.")}</p>
          <div className="login-features">
            {features.map(({ icon: Icon, title: featureTitle, description: featureDescription }) => (
              <div className="login-feature" key={featureTitle}>
                <span><Icon size={23} strokeWidth={1.7} aria-hidden="true" /></span>
                <div><strong>{t(featureTitle)}</strong><p>{t(featureDescription)}</p></div>
              </div>
            ))}
          </div>
          {/* Decorative dashboard detail from the supplied design, never live business data. */}
          <div className="login-art" aria-hidden="true">
            <div className="login-art-orbit" />
            <div className="login-dashboard-image" />
          </div>
        </section>

        <section className="login-card" aria-labelledby="login-card-title">
          <div className="login-card-header">
            <span className="login-mark login-card-mark"><Boxes aria-hidden="true" /></span>
            <p className="login-card-brand">VAE Inventory</p>
            <h2 id="login-card-title">{t(title)}</h2>
            <p>{t(description)}</p>
          </div>
          {children}
          {showRegistration && (
            <>
              <div className="login-divider"><span>{t("OR")}</span></div>
              <Link to="/register" className="login-create"><Boxes size={19} aria-hidden="true" />{t("Create an account")}</Link>
              <p className="login-card-note">{t("Build a smarter, more organized business with VAE Inventory.")}</p>
            </>
          )}
        </section>
      </main>
      <footer className="login-footer"><span>VAE Inventory</span><span>{t("A little more clarity. Every business day.")}</span></footer>
    </div>
  )
}
