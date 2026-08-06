export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  children,
  onClick,
  style: styleProp,
  ...rest
}) {
  const [hovered, setHovered] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);

  const sizes = {
    sm: { padding: '8px 20px',  fontSize: '14px', height: '36px' },
    md: { padding: '12px 28px', fontSize: '16px', height: '44px' },
    lg: { padding: '15px 36px', fontSize: '18px', height: '52px' },
  };

  const base = {
    background: 'var(--color-pink)',
    color: '#FFFFFF',
    border: 'none',
    boxShadow: hovered ? 'var(--shadow-pink)' : 'none',
    transform: pressed ? 'scale(0.96)' : hovered ? 'scale(1.02)' : 'scale(1)',
  };

  const variants = {
    primary: base,
    teal: {
      background: hovered ? 'var(--color-secondary-hover)' : 'var(--color-teal)',
      color: '#FFFFFF',
      border: 'none',
      boxShadow: hovered ? 'var(--shadow-teal)' : 'none',
      transform: pressed ? 'scale(0.96)' : hovered ? 'scale(1.02)' : 'scale(1)',
    },
    secondary: {
      background: 'transparent',
      color: 'var(--color-pink)',
      border: '2px solid var(--color-pink)',
      boxShadow: 'none',
      transform: pressed ? 'scale(0.96)' : 'scale(1)',
    },
    ghost: {
      background: hovered ? 'rgba(240,25,107,0.10)' : 'transparent',
      color: 'var(--color-pink)',
      border: 'none',
      boxShadow: 'none',
      transform: pressed ? 'scale(0.96)' : 'scale(1)',
    },
    amber: {
      background: hovered ? '#a8780e' : 'var(--color-amber)',
      color: '#FFFFFF',
      border: 'none',
      boxShadow: 'none',
      transform: pressed ? 'scale(0.96)' : hovered ? 'scale(1.02)' : 'scale(1)',
    },
    dark: {
      background: hovered ? '#333333' : 'var(--color-bg-card)',
      color: '#FFFFFF',
      border: 'none',
      boxShadow: 'none',
      transform: pressed ? 'scale(0.96)' : 'scale(1)',
    },
  };

  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    borderRadius: 'var(--radius-btn)',
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-bold)',
    letterSpacing: '0.01em',
    lineHeight: 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    transition: 'all 150ms ease',
    outline: 'none',
    whiteSpace: 'nowrap',
    width: fullWidth ? '100%' : 'auto',
    ...sizes[size],
    ...(variants[variant] || variants.primary),
    ...styleProp,
  };

  return (
    <button
      style={style}
      disabled={disabled}
      onClick={!disabled ? onClick : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      {...rest}
    >
      {loading ? <span style={{ opacity: 0.7 }}>…</span> : children}
    </button>
  );
}
