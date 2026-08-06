/**
 * Small status or category label. Pill-shaped, translucent or solid fill.
 */
export interface BadgeProps {
  /** Color variant — translucent or solid */
  variant?: 'pink' | 'teal' | 'amber' | 'yellow' | 'green' | 'neutral' | 'solid_pink' | 'solid_teal' | 'solid_amber';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
