import { useColorScheme } from 'react-native';
import {
  dark,
  font,
  light,
  radius,
  space,
  touchTarget,
  type ColorScheme,
  type Tone,
} from '@homebell/design-tokens';

export interface Theme {
  c: ColorScheme;
  space: typeof space;
  radius: typeof radius;
  font: typeof font;
  touchTarget: number;
  tone: (t: Tone) => { fg: string; bg: string; border: string };
}

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? dark : light;
  return { c, space, radius, font, touchTarget, tone: (t) => c.tones[t] };
}
