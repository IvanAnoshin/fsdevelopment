export default function PostAuthSummaryCard({
  badge,
  value,
  title,
  text,
  meta,
  onClick,
  active = false,
  className = '',
  actions = null,
  tone = '',
}) {
  const Tag = onClick ? 'button' : 'section';
  const actionProps = onClick ? { type: 'button', onClick } : {};

  return (
    <Tag
      className={[
        'pa-card',
        'pa-postauth-summary-card',
        tone ? `tone-${tone}` : '',
        active ? 'is-active' : '',
        onClick ? 'is-clickable' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...actionProps}
    >
      {(badge || meta) && (
        <div className="pa-postauth-summary-head">
          {badge ? <div className="pa-pill-row">{badge}</div> : <span />}
          {meta ? <div className="pa-postauth-summary-meta">{meta}</div> : null}
        </div>
      )}
      {value !== undefined && value !== null ? <strong className="pa-postauth-summary-value">{value}</strong> : null}
      {title ? <div className="pa-postauth-summary-title">{title}</div> : null}
      {text ? <div className="pa-postauth-summary-text">{text}</div> : null}
      {actions ? <div className="pa-postauth-summary-actions">{actions}</div> : null}
    </Tag>
  );
}
