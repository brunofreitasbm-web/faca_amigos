/**
 * Primary interactive button. Fully rounded pill shape with brand color variants.
 * @startingPoint section="Core Components" subtitle="Pill button — primary, teal, secondary, ghost" viewport="400x200"
 */
export interface ButtonProps {
  /** Visual style */
  variant?: 'primary' | 'teal' | 'secondary' | 'ghost' | 'amber' | 'dark';
  /** Size preset */
  size?: 'sm' | 'md' | 'lg';
  /** Stretch to container width */
  fullWidth?: boolean;
  /** Disabled state — reduces opacity, blocks click */
  disabled?: boolean;
  /** Shows ellipsis loading indicator */
  loading?: boolean;
  children?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}
