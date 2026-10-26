import { useColorScheme } from 'react-native';

// The site's zinc palette, so the app and ufc.sh read as one product.
export const Colors = {
  light: {
    text: '#18181b',
    textSecondary: '#71717a',
    background: '#f4f4f5',
    card: '#ffffff',
    border: '#e4e4e7',
    win: '#16a34a',
    loss: '#dc2626',
  },
  dark: {
    text: '#fafafa',
    textSecondary: '#a1a1aa',
    background: '#09090b',
    card: '#18181b',
    border: '#27272a',
    win: '#4ade80',
    loss: '#f87171',
  },
} as const;

export type Palette = (typeof Colors)['light' | 'dark'];

export function useTheme(): Palette {
  return Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
