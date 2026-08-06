/**
 * User avatar — circular image or auto-colored initials fallback.
 */
export interface AvatarProps {
  /** Image URL */
  src?: string;
  /** Full name — used for initials and deterministic background color */
  name?: string;
  /** Diameter in px */
  size?: number;
  /** 'ring' wraps the avatar in the brand gradient ring (like CircleButton) */
  variant?: 'default' | 'ring';
  style?: React.CSSProperties;
}
