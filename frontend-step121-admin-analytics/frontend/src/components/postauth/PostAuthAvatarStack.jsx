export default function PostAuthAvatarStack({
  items = [],
  getKey,
  getLabel,
  emptyLabel = '+',
  className = '',
  avatarClassName = '',
  ariaHidden = true,
  max = 4,
}) {
  const visibleItems = Array.isArray(items) ? items.slice(0, max) : [];

  return (
    <div className={`pa-postauth-avatar-stack ${className}`.trim()} aria-hidden={ariaHidden}>
      {visibleItems.length > 0 ? visibleItems.map((item, index) => (
        <div
          key={getKey ? getKey(item, index) : item?.id ?? index}
          className={`pa-postauth-stack-avatar ${avatarClassName}`.trim()}
          title={typeof getLabel === 'function' ? getLabel(item, index) : undefined}
        >
          {typeof getLabel === 'function' ? getLabel(item, index) : String(item ?? '')}
        </div>
      )) : (
        <div className={`pa-postauth-stack-avatar ${avatarClassName}`.trim()}>{emptyLabel}</div>
      )}
    </div>
  );
}
