export default function PostAuthNoticeCard({
  tone = 'neutral',
  title,
  text,
  icon = null,
  meta = null,
  actions = [],
  className = '',
  children = null,
}) {
  const validActions = Array.isArray(actions) ? actions.filter(Boolean) : [];

  return (
    <section className={['pa-card', 'pa-postauth-notice-card', `tone-${tone}`, className].filter(Boolean).join(' ')}>
      <div className="pa-postauth-notice-main">
        {icon ? <div className="pa-postauth-notice-icon">{icon}</div> : null}
        <div className="pa-postauth-notice-copy">
          {title ? <div className="pa-postauth-notice-title">{title}</div> : null}
          {meta ? <div className="pa-postauth-notice-meta">{meta}</div> : null}
          {text ? <div className="pa-postauth-notice-text">{text}</div> : null}
          {children}
        </div>
      </div>
      {validActions.length > 0 ? (
        <div className="pa-postauth-notice-actions pa-action-row">
          {validActions.map((action, index) => {
            const {
              key,
              label,
              onClick,
              className: actionClassName = 'pa-secondary-btn',
              disabled = false,
              to = null,
            } = action;

            if (to) {
              return (
                <a
                  key={key || `${label}-${index}`}
                  href={to}
                  className={actionClassName}
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {label}
                </a>
              );
            }

            return (
              <button
                key={key || `${label}-${index}`}
                type="button"
                className={actionClassName}
                onClick={onClick}
                disabled={disabled}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
