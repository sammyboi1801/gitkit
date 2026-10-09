export interface MenuItem {
  label: string;
  icon: string;
  /** Shown on hover: the exact command, or why it's disabled. */
  title?: string;
  disabled?: boolean;
  run: () => void;
}
