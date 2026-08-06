export function Badge({
  variant = 'pink',
  children,
  style: styleProp,
  ...rest
}) {
  const variants = {
    pink:    { background: 'rgba(240,25,107,0.15)',  color: 'var(--color-pink)',   border: '1px solid rgba(240,25,107,0.3)' },
    teal:    { background: 'rgba(46,207,181,0.15)',  color: 'var(--color-teal)',   border: '1px solid rgba(46,207,181,0.3)' },
    amber:   { background: 'rgba(201,144,32,0.15)',  color: 'var(--color-amber)',  border: '1px solid rgba(201,144,32,0.3)' },
    yellow:  { background: 'rgba(255,226,52,0.18)',  color: '#a8860a',             border: '1px solid rgba(255,226,52,0.4)' },
    green:   { background: 'rgba(40,200,128,0.15)',  color: '#1a9c5e',             border: '1px solid rgba(40,200,128,0.3)' },
    neutral: { background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.70)', border: '1px solid rgba(255,255,255,0.15)' },
    solid_pink:  { background: 'var(--color-pink)',  color: '#fff', border: 'none' },
    solid_teal:  { background: 'var(--color-teal)',  color: '#fff', border: 'none' },
    solid_amber: { background: 'var(--color-amber)', color: '#fff', border: 'none' },
  };

  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '4px 10px',
    borderRadius: 'var(--radius-badge)',
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-semibold)',
    fontSize: '12px',
    lineHeight: 1,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    ...(variants[variant] || variants.pink),
    ...styleProp,
  };

  return (
    <span style={style} {...rest}>
      {children}
    </span>
  );
}
