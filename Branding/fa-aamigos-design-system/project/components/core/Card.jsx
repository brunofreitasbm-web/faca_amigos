export function Card({
  variant = 'dark',
  imageSrc,
  imageAlt = '',
  title,
  subtitle,
  children,
  onClick,
  style: styleProp,
  ...rest
}) {
  const [hovered, setHovered] = React.useState(false);

  const isDark = variant === 'dark';

  const cardStyle = {
    borderRadius: 'var(--radius-card)',
    overflow: 'hidden',
    background: isDark ? 'var(--color-bg-card)' : '#FFFFFF',
    boxShadow: hovered
      ? isDark ? '0 8px 32px rgba(0,0,0,0.5)' : 'var(--shadow-lg)'
      : isDark ? 'var(--shadow-md)' : 'var(--shadow-sm)',
    cursor: onClick ? 'pointer' : 'default',
    transition: 'box-shadow 200ms ease, transform 200ms ease',
    transform: hovered && onClick ? 'translateY(-2px)' : 'translateY(0)',
    ...styleProp,
  };

  const imageStyle = {
    width: '100%',
    aspectRatio: '16/9',
    objectFit: 'cover',
    display: 'block',
  };

  const bodyStyle = {
    padding: '16px 20px 20px',
  };

  const titleStyle = {
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-extrabold)',
    fontSize: '18px',
    color: isDark ? '#FFFFFF' : 'var(--color-dark)',
    margin: '0 0 4px',
    lineHeight: 'var(--leading-snug)',
  };

  const subtitleStyle = {
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-regular)',
    fontSize: '14px',
    color: isDark ? 'rgba(255,255,255,0.55)' : 'var(--color-gray-500)',
    margin: '0 0 12px',
    lineHeight: 'var(--leading-normal)',
  };

  return (
    <div
      style={cardStyle}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...rest}
    >
      {imageSrc && (
        <img src={imageSrc} alt={imageAlt} style={imageStyle} />
      )}
      <div style={bodyStyle}>
        {title && <p style={titleStyle}>{title}</p>}
        {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
