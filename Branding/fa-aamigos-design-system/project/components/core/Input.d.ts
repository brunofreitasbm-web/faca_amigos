/**
 * Text input field with label and error state. Dark or light theme.
 */
export interface InputProps {
  label?: string;
  placeholder?: string;
  type?: string;
  /** Dark (app) or light (web) theme */
  variant?: 'dark' | 'light';
  /** Error message shown below the input */
  error?: string;
  disabled?: boolean;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  style?: React.CSSProperties;
}
