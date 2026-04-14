export default function PostAuthSectionHead({
  title,
  meta,
  actions,
  className = '',
}) {
  return (
    <div className={['pa-section-head', 'pa-postauth-section-head', className].filter(Boolean).join(' ')}>
      <div>
        <div className="pa-section-title">{title}</div>
        {meta ? <div className="pa-section-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="pa-postauth-section-actions">{actions}</div> : null}
    </div>
  );
}
