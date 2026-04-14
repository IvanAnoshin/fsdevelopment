import PostAuthUserActionRow from './PostAuthUserActionRow';

export default function PostAuthUserCard({
  user,
  avatarLabel,
  title,
  subtitle,
  description,
  badges = [],
  trailing = null,
  actions = [],
  onOpenProfile,
  className = '',
  compact = false,
  titleAsButton = true,
}) {
  const content = (
    <>
      <div className="pa-user-card-head">
        <div className="pa-inline-row pa-user-card-main-wrap" style={{ minWidth: 0, alignItems: 'flex-start' }}>
          <button
            type="button"
            className={`pa-user-card-avatar ${compact ? 'is-compact' : ''}`.trim()}
            onClick={onOpenProfile}
            disabled={!onOpenProfile}
          >
            {avatarLabel}
          </button>
          <div className="pa-user-card-main">
            {titleAsButton ? (
              <button type="button" className="pa-user-card-title" onClick={onOpenProfile}>
                {title}
              </button>
            ) : (
              <div className="pa-user-card-title">{title}</div>
            )}
            {subtitle && <div className="pa-user-card-subtitle">{subtitle}</div>}
            {description && <div className="pa-user-card-description">{description}</div>}
            {badges.length > 0 && (
              <div className="pa-user-card-badges pa-pill-row">
                {badges.map((badge, index) => (
                  <span key={`${badge.label}-${index}`} className={`pa-pill ${badge.cls || 'neutral'}`}>
                    {badge.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {trailing ? <div className="pa-user-card-trailing">{trailing}</div> : null}
      </div>
      <PostAuthUserActionRow actions={actions} />
    </>
  );

  return (
    <div className={`pa-user-card pa-card ${compact ? 'is-compact' : ''} ${className}`.trim()}>
      {content}
    </div>
  );
}
