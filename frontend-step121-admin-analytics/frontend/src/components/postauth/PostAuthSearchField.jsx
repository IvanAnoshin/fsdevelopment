export default function PostAuthSearchField({
  value,
  onChange,
  placeholder = 'Поиск',
  inputRef,
  onClear,
  className = '',
  inputProps = {},
  autoFocus = false,
}) {
  return (
    <label className={['pa-search', 'pa-postauth-search-field', className].filter(Boolean).join(' ')} style={{ marginTop: 0 }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange?.(e.target.value, e)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        {...inputProps}
      />
      {value && onClear && (
        <button type="button" className="pa-clear-btn" onClick={onClear} aria-label="Очистить поиск">
          ×
        </button>
      )}
    </label>
  );
}
