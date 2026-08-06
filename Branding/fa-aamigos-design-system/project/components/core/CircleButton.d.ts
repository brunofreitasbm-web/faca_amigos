/**
 * App-style circular icon button with gradient ring border. Used for primary category navigation in the dark-theme mobile app.
 * @startingPoint section="Core Components" subtitle="Gradient ring circle nav button" viewport="400x180"
 */
export interface CircleButtonProps {
  /** Fill color of the inner circle */
  color?: string;
  /** Label text shown below the circle */
  label?: string;
  /** Diameter of the inner circle in px */
  size?: number;
  /** Thickness of the gradient ring gap in px */
  ringSize?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}
