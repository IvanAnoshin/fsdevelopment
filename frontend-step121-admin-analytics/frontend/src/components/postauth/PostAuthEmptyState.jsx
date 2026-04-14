function renderAction(action, tone = 'secondary') {
  if (!action) return null;
  return (
    <button
      key={action.label}
      type="button"
      className={tone === 'primary' ? 'pa-primary-btn' : tone === 'danger' ? 'pa-danger-btn' : 'pa-secondary-btn'}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      {action.label}
    </button>
  );
}

export default function PostAuthEmptyState({
  title,
  text,
  icon = null,
  primaryAction,
  secondaryAction,
  tertiaryAction,
  className = '',
}) {
  return (
    <div className={['pa-card', 'pa-empty', 'pa-postauth-empty', className].filter(Boolean).join(' ')}>
      {icon ? <div className="pa-empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {(primaryAction || secondaryAction || tertiaryAction) ? (
        <div className="pa-action-row pa-postauth-empty-actions">
          {renderAction(tertiaryAction, 'secondary')}
          {renderAction(secondaryAction, 'secondary')}
          {renderAction(primaryAction, primaryAction?.tone || 'primary')}
        </div>
      ) : null}
    </div>
  );
}
