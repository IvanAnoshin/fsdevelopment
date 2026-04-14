import PostAuthStatCard from './PostAuthStatCard';

function renderBadge(badge) {
  if (!badge) return null;
  if (typeof badge === 'string') return <span className="pa-postauth-hero-badge">{badge}</span>;
  return badge;
}

export default function PostAuthHero({
  badge,
  title,
  text,
  actions,
  stats = [],
  visual,
  className = '',
  bodyClassName = '',
  sideClassName = '',
  titleTag = 'h2',
  children,
}) {
  const TitleTag = titleTag;

  return (
    <section className={[
      'pa-card',
      'pa-glass',
      'pa-postauth-hero',
      className,
    ].filter(Boolean).join(' ')}>
      <div className="pa-postauth-hero-top">
        <div className={['pa-postauth-hero-main', bodyClassName].filter(Boolean).join(' ')}>
          {renderBadge(badge)}
          {title && <TitleTag className="pa-postauth-hero-title">{title}</TitleTag>}
          {text && <p className="pa-postauth-hero-text">{text}</p>}
          {!!stats.length && (
            <div className="pa-postauth-stat-grid">
              {stats.map((item, index) => (
                <PostAuthStatCard
                  key={item?.key || item?.label || index}
                  value={item?.value}
                  label={item?.label}
                  eyebrow={item?.eyebrow}
                  tone={item?.tone}
                  active={item?.active}
                  onClick={item?.onClick}
                />
              ))}
            </div>
          )}
          {actions && <div className="pa-postauth-hero-actions">{actions}</div>}
          {children}
        </div>
        {visual && <div className={['pa-postauth-hero-side', sideClassName].filter(Boolean).join(' ')}>{visual}</div>}
      </div>
    </section>
  );
}
