import React, { createContext, useState, useContext, useEffect } from 'react';
import {
  LayoutAnimation,
  Platform,
  UIManager,
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const THEME_STORAGE_KEY = '@barreto_cambio_theme';

export const palettes = {
  light: {
    mode: 'light',
    background: '#EDEDEB',
    outerSurface: '#F5F5F3',
    cardSurface: '#FFFFFF',
    cardBorder: 'rgba(0, 0, 0, 0.06)',
    elevatedPill: '#F2F2F0',
    elevatedPillBorder: 'rgba(0, 0, 0, 0.05)',
    inputUnderline: '#E2E2DE',
    inputUnderlineActive: '#60D60C',
    textPrimary: '#141413',
    textSecondary: '#6E6E6A',
    textMuted: '#9E9E98',
    accentGreen: '#63DF0C',
    accentGreenText: '#111A09',
    trendUp: '#1FA937',
    trendUpBg: 'rgba(31, 169, 55, 0.10)',
    trendDown: '#E53935',
    trendDownBg: 'rgba(229, 57, 53, 0.10)',
    trendNeutral: '#6E6E6A',
    offlineBadgeBg: 'rgba(245, 158, 11, 0.14)',
    offlineBadgeText: '#B45309',
    toastBg: '#18181A',
    toastText: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
  },
  dark: {
    mode: 'dark',
    background: '#121315',
    outerSurface: '#181A1D',
    cardSurface: '#202226',
    cardBorder: 'rgba(255, 255, 255, 0.07)',
    elevatedPill: '#1A1C1F',
    elevatedPillBorder: 'rgba(255, 255, 255, 0.05)',
    inputUnderline: '#505358',
    inputUnderlineActive: '#65E60E',
    textPrimary: '#F7F7F8',
    textSecondary: '#A0A4AB',
    textMuted: '#6C7077',
    accentGreen: '#64E30E',
    accentGreenText: '#121E08',
    trendUp: '#4CE038',
    trendUpBg: 'rgba(76, 224, 56, 0.10)',
    trendDown: '#FF453A',
    trendDownBg: 'rgba(255, 69, 58, 0.10)',
    trendNeutral: '#A0A4AB',
    offlineBadgeBg: 'rgba(251, 191, 36, 0.15)',
    offlineBadgeText: '#FBBF24',
    toastBg: '#F7F7F8',
    toastText: '#121315',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
  },
};

const ThemeContext = createContext({
  isDark: true,
  colors: palettes.dark,
  toggleTheme: () => {},
});

export const ThemeProvider = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [isDark, setIsDark] = useState(
    systemColorScheme ? systemColorScheme === 'dark' : true
  );

  useEffect(() => {
    (async () => {
      try {
        const storedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (storedTheme !== null) {
          setIsDark(storedTheme === 'dark');
        }
      } catch (_err) {
        // Silencioso en caso de fallo de lectura local
      }
    })();
  }, []);

  const toggleTheme = async () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const nextMode = !isDark;
    setIsDark(nextMode);
    try {
      await AsyncStorage.setItem(
        THEME_STORAGE_KEY,
        nextMode ? 'dark' : 'light'
      );
    } catch (_err) {
      // Silencioso
    }
  };

  const colors = isDark ? palettes.dark : palettes.light;

  return (
    <ThemeContext.Provider value={{ isDark, colors, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
