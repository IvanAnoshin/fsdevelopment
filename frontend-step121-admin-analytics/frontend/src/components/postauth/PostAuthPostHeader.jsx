export default function PostAuthPostHeader({
  avatarLabel,
  title,
  subtitle,
  meta,
  onOpenProfile,
  trailing = null,
  className = '',
  titleAsButton = true,
}) {
  const titleNode = titleAsButton ? (
    <button type="button" className="pa-postauth-post-title" onClick={onOpenProfile} disabled={!onOpenProfile}>
      {title}
    </button>
  ) : (
    <div className="pa-postauth-post-title">{title}</div>
  );

  return (
    <div className={['pa-post-header', 'pa-postauth-post-header', className].filter(Boolean).join(' ')}>
      <div className="pa-inline-row pa-postauth-post-author-block" style={{ minWidth: 0 }}>
        <button
          type="button"
          className="pa-avatar-sm pa-postauth-post-avatar"
          onClick={onOpenProfile}
          disabled={!onOpenProfile}
        >
          {avatarLabel}
        </button>
        <div className="pa-post-author pa-postauth-post-author-copy">
          {titleNode}
          {(subtitle || meta) && (
            <div className="pa-meta pa-postauth-post-submeta">
              {subtitle}
              {subtitle && meta ? ' · ' : ''}
              {meta}
            </div>
          )}
        </div>
      </div>
      {trailing ? <div className="pa-postauth-post-trailing">{trailing}</div> : null}
    </div>
  );
}
