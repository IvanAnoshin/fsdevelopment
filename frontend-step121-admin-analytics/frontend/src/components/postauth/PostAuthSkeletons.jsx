export function PostAuthSkeletonPostCard({ compact = false }) {
  return (
    <article className={`pa-card pa-skeleton-card pa-skeleton-post ${compact ? 'is-compact' : ''}`.trim()}>
      <div className="pa-skeleton-row">
        <div className="pa-skeleton-avatar" />
        <div className="pa-skeleton-stack">
          <div className="pa-skeleton-line w-56" />
          <div className="pa-skeleton-line w-28" />
        </div>
      </div>
      <div className="pa-skeleton-stack pa-skeleton-gap-lg">
        <div className="pa-skeleton-line w-100" />
        <div className="pa-skeleton-line w-92" />
        <div className="pa-skeleton-line w-74" />
      </div>
      {!compact && <div className="pa-skeleton-media" />}
      <div className="pa-skeleton-action-row">
        <div className="pa-skeleton-pill w-18" />
        <div className="pa-skeleton-pill w-22" />
        <div className="pa-skeleton-pill w-16" />
      </div>
    </article>
  );
}

export function PostAuthSkeletonNotificationCard() {
  return (
    <article className="pa-card pa-skeleton-card pa-skeleton-notification">
      <div className="pa-skeleton-row pa-skeleton-row-top">
        <div className="pa-skeleton-icon" />
        <div className="pa-skeleton-stack">
          <div className="pa-skeleton-line w-32" />
          <div className="pa-skeleton-line w-20" />
        </div>
      </div>
      <div className="pa-skeleton-stack pa-skeleton-gap-lg">
        <div className="pa-skeleton-line w-100" />
        <div className="pa-skeleton-line w-88" />
      </div>
      <div className="pa-skeleton-action-row">
        <div className="pa-skeleton-pill w-18" />
        <div className="pa-skeleton-pill w-22" />
      </div>
    </article>
  );
}

export function PostAuthSkeletonUserCard() {
  return (
    <article className="pa-card pa-skeleton-card pa-skeleton-user">
      <div className="pa-skeleton-row">
        <div className="pa-skeleton-avatar" />
        <div className="pa-skeleton-stack">
          <div className="pa-skeleton-line w-44" />
          <div className="pa-skeleton-line w-28" />
          <div className="pa-skeleton-line w-68" />
        </div>
      </div>
      <div className="pa-skeleton-action-row">
        <div className="pa-skeleton-pill w-20" />
        <div className="pa-skeleton-pill w-18" />
      </div>
    </article>
  );
}
