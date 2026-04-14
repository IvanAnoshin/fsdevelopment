import PostAuthUserActionRow from './PostAuthUserActionRow';

export default function PostAuthNotificationCard({
  icon,
  badges = [],
  time,
  meta,
  content,
  actions = [],
  isUnread = false,
  className = '',
}) {
  return (
    <article className={['pa-card', 'pa-postauth-notification-card', isUnread ? 'is-unread' : '', className].filter(Boolean).join(' ')}>
      <div className="pa-postauth-notification-top">
        <div className="pa-inline-row" style={{ gap: 10, alignItems: 'center' }}>
          {icon ? <div className="pa-postauth-notification-icon">{icon}</div> : null}
          <div className="pa-postauth-notification-headings">
            {badges.length ? <div className="pa-pill-row">{badges}</div> : null}
            {time ? <div className="pa-time">{time}</div> : null}
          </div>
        </div>
        {meta ? <div className="pa-postauth-notification-meta">{meta}</div> : null}
      </div>

      {content ? <div className="pa-postauth-notification-body">{content}</div> : null}

      {actions?.length ? (
        <PostAuthUserActionRow className="pa-postauth-notification-actions" actions={actions} />
      ) : null}
    </article>
  );
}
