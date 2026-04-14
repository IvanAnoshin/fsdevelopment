import { Link } from 'react-router-dom';

export default function PreAuthLayout({
  badge,
  title,
  subtitle,
  heroTitle,
  heroText,
  stats = [],
  pills = [],
  panelEyebrow,
  panelTitle,
  panelSubtitle,
  footer,
  children,
}) {
  return (
    <div className="auth-container auth-preauth">
      <div className="auth-preauth-shell">
        <section className="auth-preauth-hero">
          <div className="auth-preauth-hero-card">
            {badge ? <div className="auth-preauth-badge">{badge}</div> : null}
            <div className="auth-preauth-hero-top">
              <div className="auth-preauth-copy">
                <h1 className="auth-preauth-title">{title}</h1>
                {subtitle ? <p className="auth-preauth-subtitle">{subtitle}</p> : null}
              </div>
              <div className="auth-preauth-orb" aria-hidden="true">
                <span className="auth-preauth-orb-dot auth-preauth-orb-dot-one" />
                <span className="auth-preauth-orb-dot auth-preauth-orb-dot-two" />
                <span className="auth-preauth-orb-ring" />
              </div>
            </div>

            {(heroTitle || heroText) && (
              <div className="auth-preauth-story glass-panel-lite">
                {heroTitle ? <div className="auth-preauth-story-title">{heroTitle}</div> : null}
                {heroText ? <div className="auth-preauth-story-text">{heroText}</div> : null}
              </div>
            )}

            {stats.length > 0 && (
              <div className="auth-preauth-stats">
                {stats.map((item) => (
                  <div className="auth-preauth-stat" key={item.label}>
                    <div className="auth-preauth-stat-value">{item.value}</div>
                    <div className="auth-preauth-stat-label">{item.label}</div>
                  </div>
                ))}
              </div>
            )}

            {pills.length > 0 && (
              <div className="auth-preauth-pills">
                {pills.map((pill) => (
                  <span className="auth-preauth-pill" key={pill}>{pill}</span>
                ))}
              </div>
            )}

            <div className="auth-preauth-quick-links">
              <Link to="/login" className="auth-preauth-quick-link">Вход</Link>
              <Link to="/register" className="auth-preauth-quick-link">Регистрация</Link>
              <Link to="/recovery" className="auth-preauth-quick-link">Восстановление</Link>
            </div>
          </div>
        </section>

        <section className="auth-card form-card auth-preauth-panel">
          <div className="auth-preauth-panel-head">
            {panelEyebrow ? <div className="auth-preauth-panel-eyebrow">{panelEyebrow}</div> : null}
            <h2 className="auth-preauth-panel-title">{panelTitle}</h2>
            {panelSubtitle ? <p className="auth-preauth-panel-subtitle">{panelSubtitle}</p> : null}
          </div>
          {children}
          {footer ? <div className="auth-preauth-panel-footer">{footer}</div> : null}
        </section>
      </div>
    </div>
  );
}
