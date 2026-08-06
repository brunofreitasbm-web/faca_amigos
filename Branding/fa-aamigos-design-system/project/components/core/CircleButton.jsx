export function CircleButton({
  color = '#F05870',
  label,
  size = 88,
  ringSize = 4,
  onClick,
  style: styleProp,
  ...rest
}) {
  const [pressed, setPressed] = React.useState(false);

  const outerSize = size + ringSize * 2 + 6;

  const outerStyle = {
    width: outerSize + 'px',
    height: outerSize + 'px',
    borderRadius: '50%',
    background: 'var(--gradient-ring)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3px',
    cursor: onClick ? 'pointer' : 'default',
    transform: pressed ? 'scale(0.93)' : 'scale(1)',
    transition: 'transform 200ms cubic-bezier(0.34,1.56,0.64,1)',
    flexShrink: 0,
    ...styleProp,
  };

  const darkRingStyle = {
    width: (size + 6) + 'px',
    height: (size + 6) + 'px',
    borderRadius: '50%',
    background: 'var(--color-bg-app)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3px',
  };

  const innerStyle = {
    width: size + 'px',
    height: size + 'px',
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  };

  const wrapperStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    cursor: onClick ? 'pointer' : 'default',
  };

  const labelStyle = {
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-semibold)',
    fontSize: '14px',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 1.2,
  };

  return (
    <div
      style={wrapperStyle}
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      {...rest}
    >
      <div style={outerStyle}>
        <div style={darkRingStyle}>
          <div style={innerStyle} />
        </div>
      </div>
      {label && <span style={labelStyle}>{label}</span>}
    </div>
  );
}
