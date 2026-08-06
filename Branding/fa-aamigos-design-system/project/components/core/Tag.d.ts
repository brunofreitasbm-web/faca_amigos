/**
 * Inline filter chip or category tag with colored dot. Optionally removable.
 */
export interface TagProps {
  children?: React.ReactNode;
  /** Accent dot color — defaults to brand teal */
  color?: string;
  /** Renders a remove (×) button inside the tag */
  onRemove?: () => void;
  style?: React.CSSProperties;
}
