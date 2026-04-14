export default function PostAuthMetaGrid({
  items = [],
  className = '',
  itemClassName = '',
  labelClassName = '',
  valueClassName = '',
  style,
}) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (safeItems.length === 0) return null;

  return (
    <div className={['pa-postauth-meta-grid', className].filter(Boolean).join(' ')} style={style}>
      {safeItems.map((item, index) => (
        <div
          key={item.key || item.label || index}
          className={['pa-postauth-meta-card', itemClassName, item.className].filter(Boolean).join(' ')}
        >
          <div className={['pa-postauth-meta-label', labelClassName, item.labelClassName].filter(Boolean).join(' ')}>{item.label}</div>
          <div className={['pa-postauth-meta-value', valueClassName, item.valueClassName].filter(Boolean).join(' ')}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}
