import PostAuthPostActionRow from './PostAuthPostActionRow';
import PostAuthPostHeader from './PostAuthPostHeader';

export default function PostAuthPostCard({
  className = '',
  badge = null,
  badgeMeta = null,
  header,
  highlight = null,
  content,
  media = null,
  actions = [],
  footerAside = null,
  children = null,
  onOpenProfile,
  author,
  avatarLabel,
  title,
  subtitle,
  meta,
  trailing,
}) {
  const headerNode = header || (
    <PostAuthPostHeader
      avatarLabel={avatarLabel}
      title={title}
      subtitle={subtitle}
      meta={meta}
      onOpenProfile={onOpenProfile}
      trailing={trailing}
    />
  );

  return (
    <article className={['pa-post-card', 'pa-postauth-post-card', className].filter(Boolean).join(' ')}>
      {(badge || badgeMeta) && (
        <div className="pa-postauth-post-badge-row">
          {badge || <span />}
          {badgeMeta ? <span className="pa-meta">{badgeMeta}</span> : null}
        </div>
      )}
      {headerNode}
      {highlight ? <div className="pa-postauth-post-highlight">{highlight}</div> : null}
      {content ? <div className="pa-post-content pa-postauth-post-content">{content}</div> : null}
      {media}
      <PostAuthPostActionRow actions={actions} aside={footerAside} />
      {children}
    </article>
  );
}
