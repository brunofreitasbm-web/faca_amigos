export function Avatar({
  src,
  name = '',
  size = 40,
  variant = 'default',
  style: styleProp,
  ...rest
}) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();

  const colors = ['#F0196B', '#2ECFB5', '#C99020', '#FFE234', '#1A3F35'];
  const colorIndex = name.charCodeAt(0) % colors.length || 0;
  const bgColor = colors[colorIndex];

  const wrapperStyle = variant === 'ring' ? {
    width: (size + 6) + 'px',
    height: (size + 6) + 'px',
    borderRadius: '50%',
    background: 'var(--gradient-ring)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  } : null;

  const avatarStyle = {
    width: size + 'px',
    height: size + 'px',
    borderRadius: '50%',
    background: src ? 'transparent' : bgColor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-bold)',
    fontSize: Math.max(10, Math.floor(size * 0.38)) + 'px',
    color: '#FFFFFF',
    flexShrink: 0,
    ...(!wrapperStyle ? styleProp : {}),
  };

  const imgStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  };

  const avatar = (
    <div style={avatarStyle} {...(!wrapperStyle ? rest : {})}>
      {src ? <img src={src} alt={name} style={imgStyle} /> : <span>{initials}</span>}
    </div>
  );

  if (wrapperStyle) {
    return (
      <div style={{ ...wrapperStyle, ...styleProp }} {...rest}>
        {avatar}
      </div>
    );
  }

  return avatar;
}
