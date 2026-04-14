export default function PostAuthPostActionRow({ actions = [], aside = null, className = '' }) {
  const visibleActions = actions.filter(Boolean);
  if (!visibleActions.length && !aside) return null;

  return (
    <div className={['pa-postauth-post-footer', className].filter(Boolean).join(' ')}>
      {visibleActions.length > 0 ? (
        <div className="pa-postauth-post-actions pa-feed-rating-row">
          {visibleActions.map((action) => {
            const {
              key,
              label,
              value,
              onClick,
              disabled = false,
              busy = false,
              busyLabel = '...',
              tone = 'primary',
              active = false,
              type = 'button',
              title,
            } = action;
            const className = [
              tone === 'soft' ? 'pa-soft-btn' : tone === 'secondary' ? 'pa-feed-action-btn secondary' : 'pa-feed-action-btn',
              active ? 'liked active' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={key || label}
                type={type}
                className={className}
                disabled={disabled || busy}
                onClick={onClick}
                title={title}
              >
                {busy ? busyLabel : label}
                {value !== undefined && value !== null ? <strong>{value}</strong> : null}
              </button>
            );
          })}
        </div>
      ) : <span />}
      {aside ? <div className="pa-postauth-post-aside pa-feed-side-row">{aside}</div> : null}
    </div>
  );
}
