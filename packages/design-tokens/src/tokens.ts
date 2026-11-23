/**
 * HomeBell design tokens — single source for web (CSS variables via build) and React Native
 * (imported directly). Colours meet WCAG 2.2 AA for text on their paired surfaces.
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

export const palette = {
  blue: {
    50: '#EEF5FF',
    100: '#D9E8FF',
    500: '#2F7BF5',
    600: '#1F6FEB',
    700: '#1758C2',
    900: '#0B2A5C',
  },
  slate: {
    0: '#FFFFFF',
    50: '#F7F8FA',
    100: '#EEF1F5',
    200: '#DDE2EA',
    300: '#C3CAD6',
    500: '#6B7587',
    600: '#525C6E',
    700: '#3A4354',
    800: '#252C3A',
    900: '#161B26',
    950: '#0E121A',
  },
  green: { 50: '#ECFBF2', 600: '#16884A', 700: '#0F6B39', 300: '#7FDCA6' },
  amber: { 50: '#FFF7E6', 600: '#B26A00', 700: '#8A5200', 300: '#FFCB6B' },
  red: { 50: '#FFF0F0', 600: '#D12C2C', 700: '#A81E1E', 300: '#FF9C9C' },
  violet: { 50: '#F4F0FF', 600: '#6B46C1' },
} as const;

export interface ColorScheme {
  bg: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryHover: string;
  primaryText: string;
  focus: string;
  tones: Record<Tone, { fg: string; bg: string; border: string }>;
}

export const light: ColorScheme = {
  bg: palette.slate[50],
  surface: palette.slate[0],
  surfaceMuted: palette.slate[100],
  border: palette.slate[200],
  borderStrong: palette.slate[300],
  text: palette.slate[900],
  textMuted: palette.slate[600],
  textInverse: palette.slate[0],
  primary: palette.blue[600],
  primaryHover: palette.blue[700],
  primaryText: palette.slate[0],
  focus: palette.blue[500],
  tones: {
    neutral: { fg: palette.slate[700], bg: palette.slate[100], border: palette.slate[200] },
    info: { fg: palette.blue[700], bg: palette.blue[50], border: palette.blue[100] },
    success: { fg: palette.green[700], bg: palette.green[50], border: '#BFEBD2' },
    warning: { fg: palette.amber[700], bg: palette.amber[50], border: '#FBE0A8' },
    danger: { fg: palette.red[700], bg: palette.red[50], border: '#F7C4C4' },
    brand: { fg: palette.violet[600], bg: palette.violet[50], border: '#DCD0FA' },
  },
};

export const dark: ColorScheme = {
  bg: palette.slate[950],
  surface: palette.slate[900],
  surfaceMuted: palette.slate[800],
  border: palette.slate[800],
  borderStrong: palette.slate[700],
  text: '#EEF1F5',
  textMuted: '#A9B2C1',
  textInverse: palette.slate[950],
  primary: palette.blue[500],
  primaryHover: '#5B97F7',
  primaryText: palette.slate[0],
  focus: '#7FB0FF',
  tones: {
    neutral: { fg: '#C9D0DC', bg: '#1F2532', border: '#2C3443' },
    info: { fg: '#9CC3FF', bg: '#102544', border: '#1B3A66' },
    success: { fg: palette.green[300], bg: '#0E2A1B', border: '#164A2E' },
    warning: { fg: palette.amber[300], bg: '#2E2209', border: '#4D3810' },
    danger: { fg: palette.red[300], bg: '#331414', border: '#5A2121' },
    brand: { fg: '#C4B1FF', bg: '#221A3D', border: '#3A2D66' },
  },
};

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, full: 999 } as const;
export const font = {
  family: {
    sans: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 36, display: 64 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
} as const;
/** Minimum touch target (dp / px) — WCAG 2.5.8 + platform guidance. */
export const touchTarget = 48;

/** State → tone mapping shared by every app (badges, queue cards, banners). */
export const stateTone = {
  pickup: {
    requested: 'info',
    sent_out: 'warning',
    acknowledged: 'success',
    cancelled: 'neutral',
    exception: 'danger',
    resolved: 'neutral',
  },
  guardian: {
    pending_activation: 'info',
    active: 'success',
    blocked: 'danger',
    deactivated: 'neutral',
    revoked: 'neutral',
    expired: 'warning',
  },
  tenant: {
    draft: 'neutral',
    trial: 'info',
    pilot_free: 'brand',
    active_paid: 'success',
    manual_override: 'brand',
    suspended: 'warning',
    deactivated: 'danger',
    cancelled: 'danger',
    offboarding: 'neutral',
    expired: 'warning',
  },
  invitation: { pending: 'info', redeemed: 'success', expired: 'warning', revoked: 'neutral' },
  seat: { available: 'success', assigned: 'info', expired: 'neutral', voided: 'danger' },
  device: { active: 'success', revoked: 'neutral', transferred_out: 'neutral' },
  display: { pairing: 'info', active: 'success', revoked: 'neutral' },
  membership: { invited: 'info', active: 'success', deactivated: 'neutral' },
  student: { active: 'success', inactive: 'neutral' },
  eligibility: { eligible: 'success', hold: 'warning', not_eligible: 'neutral' },
  operationalMode: {
    setup: 'neutral',
    full: 'success',
    read_only: 'warning',
    blocked: 'danger',
    export_only: 'neutral',
  },
} as const satisfies Record<string, Record<string, Tone>>;

export const toneOf = (group: keyof typeof stateTone, value: string): Tone =>
  (stateTone[group] as Record<string, Tone>)[value] ?? 'neutral';
