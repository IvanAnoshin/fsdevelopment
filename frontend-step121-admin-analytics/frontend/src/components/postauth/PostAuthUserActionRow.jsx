export default function PostAuthUserActionRow({ actions = [], className = '' }) {
  const visibleActions = actions.filter(Boolean);
  if (!visibleActions.length) return null;

  return (
    <div className={`pa-user-card-actions pa-action-row ${className}`.trim()}>
      {visibleActions.map((action) => {
        const {
          key,
          label,
          onClick,
          disabled = false,
          tone = 'secondary',
          busy = false,
          busyLabel = '...',
          type = 'button',
          title,
        } = action;
        const className = tone === 'primary' ? 'pa-primary-btn' : 'pa-secondary-btn';
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
          </button>
        );
      })}
    </div>
  );
}
