export default function PostAuthStatCard({
  value,
  label,
  eyebrow,
  tone,
  active = false,
  onClick,
  className = '',
}) {
  const Tag = onClick ? 'button' : 'div';
  const actionProps = onClick ? { type: 'button', onClick } : {};

  return (
    <Tag
      className={[
        'pa-postauth-stat-card',
        tone ? `tone-${tone}` : '',
        active ? 'is-active' : '',
        onClick ? 'is-clickable' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...actionProps}
    >
      {eyebrow ? <span className="pa-postauth-stat-eyebrow">{eyebrow}</span> : null}
      <strong className="pa-postauth-stat-value">{value}</strong>
      <span className="pa-postauth-stat-label">{label}</span>
    </Tag>
  );
}
