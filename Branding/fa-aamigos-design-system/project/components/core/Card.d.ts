/**
 * Content card with optional image header. Use for info sections, activity listings, and featured content.
 */
export interface CardProps {
  /** Dark (app) or light (web/marketing) theme */
  variant?: 'dark' | 'light';
  /** Optional hero image URL */
  imageSrc?: string;
  imageAlt?: string;
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}
