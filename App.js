import React from 'react';
import { ThemeProvider } from './src/context/ThemeContext';
import CalculatorScreen from './src/screens/CalculatorScreen';

export default function App() {
  return (
    <ThemeProvider>
      <CalculatorScreen />
    </ThemeProvider>
  );
}
