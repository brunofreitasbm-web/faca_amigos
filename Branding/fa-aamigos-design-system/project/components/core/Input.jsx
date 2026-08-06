export function Input({
  label,
  placeholder,
  type = 'text',
  variant = 'dark',
  error,
  disabled = false,
  value,
  onChange,
  style: styleProp,
  ...rest
}) {
  const [focused, setFocused] = React.useState(false);
  const isDark = variant === 'dark';

  const wrapperStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '100%',
  };

  const labelStyle = {
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-semibold)',
    fontSize: '13px',
    color: isDark ? 'rgba(255,255,255,0.65)' : 'var(--color-gray-600)',
    letterSpacing: '0.02em',
  };

  const borderColor = error
    ? 'var(--color-error)'
    : focused
    ? 'var(--color-pink)'
    : isDark
    ? 'rgba(255,255,255,0.15)'
    : 'var(--color-gray-300)';

  const inputStyle = {
    height: '48px',
    padding: '0 16px',
    borderRadius: 'var(--radius-input)',
    border: `1.5px solid ${borderColor}`,
    background: isDark ? 'var(--color-bg-surface)' : '#FFFFFF',
    color: isDark ? '#FFFFFF' : 'var(--color-dark)',
    fontFamily: 'var(--font-body)',
    fontSize: '16px',
    fontWeight: 'var(--weight-regular)',
    outline: 'none',
    transition: 'border-color 150ms ease, box-shadow 150ms ease',
    boxShadow: focused && !error ? `0 0 0 3px rgba(240,25,107,0.18)` : 'none',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'text',
    width: '100%',
    boxSizing: 'border-box',
    ...styleProp,
  };

  const errorStyle = {
    fontFamily: 'var(--font-body)',
    fontSize: '12px',
    color: 'var(--color-error)',
    fontWeight: 'var(--weight-medium)',
  };

  return (
    <div style={wrapperStyle}>
      {label && <label style={labelStyle}>{label}</label>}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        style={inputStyle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
      />
      {error && <span style={errorStyle}>{error}</span>}
    </div>
  );
}
