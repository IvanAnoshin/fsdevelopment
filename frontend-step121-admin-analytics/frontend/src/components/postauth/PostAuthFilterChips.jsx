export default function PostAuthFilterChips({
  items = [],
  activeKey,
  onChange,
  className = '',
  chipClassName = '',
  compact = false,
}) {
  return (
    <div className={['pa-postauth-filter-chips', compact ? 'compact' : '', className].filter(Boolean).join(' ')}>
      {items.map((item) => {
        const key = item.key ?? item.id;
        const active = item.active ?? String(activeKey) === String(key);
        const tone = item.tone || item.cls || 'stone';
        const disabled = Boolean(item.disabled);
        const count = item.count;
        return (
          <button
            key={key}
            type="button"
            className={['pa-chip', tone, active ? 'active' : '', chipClassName].filter(Boolean).join(' ')}
            onClick={() => {
              if (disabled) return;
              if (item.onClick) item.onClick(item);
              else onChange?.(key, item);
            }}
            disabled={disabled}
          >
            <span>{item.label}</span>
            {typeof count === 'number' && <span className="pa-postauth-chip-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
