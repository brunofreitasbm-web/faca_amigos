/* @ds-bundle: {"format":3,"namespace":"FaAAmigosDesignSystem_e4904a","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"CircleButton","sourcePath":"components/core/CircleButton.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"111c38b32061","components/core/Badge.jsx":"2b4b481690a8","components/core/Button.jsx":"502555cb652e","components/core/Card.jsx":"3cf6aa7c7385","components/core/CircleButton.jsx":"74e827549e82","components/core/Input.jsx":"65e2ec299ecc","components/core/Tag.jsx":"7f62570d8092"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.FaAAmigosDesignSystem_e4904a = window.FaAAmigosDesignSystem_e4904a || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Avatar({
  src,
  name = '',
  size = 40,
  variant = 'default',
  style: styleProp,
  ...rest
}) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const colors = ['#F0196B', '#2ECFB5', '#C99020', '#FFE234', '#1A3F35'];
  const colorIndex = name.charCodeAt(0) % colors.length || 0;
  const bgColor = colors[colorIndex];
  const wrapperStyle = variant === 'ring' ? {
    width: size + 6 + 'px',
    height: size + 6 + 'px',
    borderRadius: '50%',
    background: 'var(--gradient-ring)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
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
    ...(!wrapperStyle ? styleProp : {})
  };
  const imgStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  };
  const avatar = /*#__PURE__*/React.createElement("div", _extends({
    style: avatarStyle
  }, !wrapperStyle ? rest : {}), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: imgStyle
  }) : /*#__PURE__*/React.createElement("span", null, initials));
  if (wrapperStyle) {
    return /*#__PURE__*/React.createElement("div", _extends({
      style: {
        ...wrapperStyle,
        ...styleProp
      }
    }, rest), avatar);
  }
  return avatar;
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Badge({
  variant = 'pink',
  children,
  style: styleProp,
  ...rest
}) {
  const variants = {
    pink: {
      background: 'rgba(240,25,107,0.15)',
      color: 'var(--color-pink)',
      border: '1px solid rgba(240,25,107,0.3)'
    },
    teal: {
      background: 'rgba(46,207,181,0.15)',
      color: 'var(--color-teal)',
      border: '1px solid rgba(46,207,181,0.3)'
    },
    amber: {
      background: 'rgba(201,144,32,0.15)',
      color: 'var(--color-amber)',
      border: '1px solid rgba(201,144,32,0.3)'
    },
    yellow: {
      background: 'rgba(255,226,52,0.18)',
      color: '#a8860a',
      border: '1px solid rgba(255,226,52,0.4)'
    },
    green: {
      background: 'rgba(40,200,128,0.15)',
      color: '#1a9c5e',
      border: '1px solid rgba(40,200,128,0.3)'
    },
    neutral: {
      background: 'rgba(255,255,255,0.10)',
      color: 'rgba(255,255,255,0.70)',
      border: '1px solid rgba(255,255,255,0.15)'
    },
    solid_pink: {
      background: 'var(--color-pink)',
      color: '#fff',
      border: 'none'
    },
    solid_teal: {
      background: 'var(--color-teal)',
      color: '#fff',
      border: 'none'
    },
    solid_amber: {
      background: 'var(--color-amber)',
      color: '#fff',
      border: 'none'
    }
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
    ...styleProp
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: style
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Button({
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
    sm: {
      padding: '8px 20px',
      fontSize: '14px',
      height: '36px'
    },
    md: {
      padding: '12px 28px',
      fontSize: '16px',
      height: '44px'
    },
    lg: {
      padding: '15px 36px',
      fontSize: '18px',
      height: '52px'
    }
  };
  const base = {
    background: 'var(--color-pink)',
    color: '#FFFFFF',
    border: 'none',
    boxShadow: hovered ? 'var(--shadow-pink)' : 'none',
    transform: pressed ? 'scale(0.96)' : hovered ? 'scale(1.02)' : 'scale(1)'
  };
  const variants = {
    primary: base,
    teal: {
      background: hovered ? 'var(--color-secondary-hover)' : 'var(--color-teal)',
      color: '#FFFFFF',
      border: 'none',
      boxShadow: hovered ? 'var(--shadow-teal)' : 'none',
      transform: pressed ? 'scale(0.96)' : hovered ? 'scale(1.02)' : 'scale(1)'
    },
    secondary: {
      background: 'transparent',
      color: 'var(--color-pink)',
      border: '2px solid var(--color-pink)',
      boxShadow: 'none',
      transform: pressed ? 'scale(0.96)' : 'scale(1)'
    },
    ghost: {
      background: hovered ? 'rgba(240,25,107,0.10)' : 'transparent',
      color: 'var(--color-pink)',
      border: 'none',
      boxShadow: 'none',
      transform: pressed ? 'scale(0.96)' : 'scale(1)'
    },
    amber: {
      background: hovered ? '#a8780e' : 'var(--color-amber)',
      color: '#FFFFFF',
      border: 'none',
      boxShadow: 'none',
      transform: pressed ? 'scale(0.96)' : hovered ? 'scale(1.02)' : 'scale(1)'
    },
    dark: {
      background: hovered ? '#333333' : 'var(--color-bg-card)',
      color: '#FFFFFF',
      border: 'none',
      boxShadow: 'none',
      transform: pressed ? 'scale(0.96)' : 'scale(1)'
    }
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
    ...styleProp
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    style: style,
    disabled: disabled,
    onClick: !disabled ? onClick : undefined,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => {
      setHovered(false);
      setPressed(false);
    },
    onMouseDown: () => setPressed(true),
    onMouseUp: () => setPressed(false)
  }, rest), loading ? /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: 0.7
    }
  }, "\u2026") : children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
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
    boxShadow: hovered ? isDark ? '0 8px 32px rgba(0,0,0,0.5)' : 'var(--shadow-lg)' : isDark ? 'var(--shadow-md)' : 'var(--shadow-sm)',
    cursor: onClick ? 'pointer' : 'default',
    transition: 'box-shadow 200ms ease, transform 200ms ease',
    transform: hovered && onClick ? 'translateY(-2px)' : 'translateY(0)',
    ...styleProp
  };
  const imageStyle = {
    width: '100%',
    aspectRatio: '16/9',
    objectFit: 'cover',
    display: 'block'
  };
  const bodyStyle = {
    padding: '16px 20px 20px'
  };
  const titleStyle = {
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-extrabold)',
    fontSize: '18px',
    color: isDark ? '#FFFFFF' : 'var(--color-dark)',
    margin: '0 0 4px',
    lineHeight: 'var(--leading-snug)'
  };
  const subtitleStyle = {
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-regular)',
    fontSize: '14px',
    color: isDark ? 'rgba(255,255,255,0.55)' : 'var(--color-gray-500)',
    margin: '0 0 12px',
    lineHeight: 'var(--leading-normal)'
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: cardStyle,
    onClick: onClick,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false)
  }, rest), imageSrc && /*#__PURE__*/React.createElement("img", {
    src: imageSrc,
    alt: imageAlt,
    style: imageStyle
  }), /*#__PURE__*/React.createElement("div", {
    style: bodyStyle
  }, title && /*#__PURE__*/React.createElement("p", {
    style: titleStyle
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    style: subtitleStyle
  }, subtitle), children));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/CircleButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function CircleButton({
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
    ...styleProp
  };
  const darkRingStyle = {
    width: size + 6 + 'px',
    height: size + 6 + 'px',
    borderRadius: '50%',
    background: 'var(--color-bg-app)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3px'
  };
  const innerStyle = {
    width: size + 'px',
    height: size + 'px',
    borderRadius: '50%',
    background: color,
    flexShrink: 0
  };
  const wrapperStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    cursor: onClick ? 'pointer' : 'default'
  };
  const labelStyle = {
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-semibold)',
    fontSize: '14px',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 1.2
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: wrapperStyle,
    onClick: onClick,
    onMouseDown: () => setPressed(true),
    onMouseUp: () => setPressed(false),
    onMouseLeave: () => setPressed(false)
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: outerStyle
  }, /*#__PURE__*/React.createElement("div", {
    style: darkRingStyle
  }, /*#__PURE__*/React.createElement("div", {
    style: innerStyle
  }))), label && /*#__PURE__*/React.createElement("span", {
    style: labelStyle
  }, label));
}
Object.assign(__ds_scope, { CircleButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/CircleButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
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
    width: '100%'
  };
  const labelStyle = {
    fontFamily: 'var(--font-body)',
    fontWeight: 'var(--weight-semibold)',
    fontSize: '13px',
    color: isDark ? 'rgba(255,255,255,0.65)' : 'var(--color-gray-600)',
    letterSpacing: '0.02em'
  };
  const borderColor = error ? 'var(--color-error)' : focused ? 'var(--color-pink)' : isDark ? 'rgba(255,255,255,0.15)' : 'var(--color-gray-300)';
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
    ...styleProp
  };
  const errorStyle = {
    fontFamily: 'var(--font-body)',
    fontSize: '12px',
    color: 'var(--color-error)',
    fontWeight: 'var(--weight-medium)'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: wrapperStyle
  }, label && /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, label), /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    style: inputStyle,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false)
  }, rest)), error && /*#__PURE__*/React.createElement("span", {
    style: errorStyle
  }, error));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tag({
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
    ...styleProp
  };
  const dotStyle = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: accent,
    flexShrink: 0
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
    flexShrink: 0
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: style
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: dotStyle
  }), children, onRemove && /*#__PURE__*/React.createElement("button", {
    style: removeStyle,
    onClick: onRemove,
    type: "button"
  }, "\u2715"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CircleButton = __ds_scope.CircleButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Tag = __ds_scope.Tag;

})();
