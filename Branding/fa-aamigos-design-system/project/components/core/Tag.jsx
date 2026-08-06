export function Tag({
  children,
  color,
  onRemove,
  style: styleProp,
  ...rest
}) {
  const accent = color || 'var(--color-teal)';

  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    borderRadius: 'var(--radius-full)',
    background: 'var(--color-bg-raised)',
    border: '1px solid rgba(255,255,255,0.10)',
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-medium)',
    fontSize: '13px',
    color: '#FFFFFF',
    lineHeight: 1,
    ...styleProp,
  };

  const dotStyle = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: accent,
    flexShrink: 0,
  };

  const removeStyle = {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    color: '#fff',
    padding: 0,
    lineHeight: 1,
    flexShrink: 0,
  };

  return (
    <span style={style} {...rest}>
      <span style={dotStyle} />
      {children}
      {onRemove && (
        <button style={removeStyle} onClick={onRemove} type="button">✕</button>
      )}
    </span>
  );
}
