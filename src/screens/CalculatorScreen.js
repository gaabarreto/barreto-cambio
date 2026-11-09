import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Keyboard,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import {
  formatCurrencyDisplay,
  parseLiveCurrencyInput,
  convertForeignToVes,
  convertVesToForeign,
} from '../utils/currencyFormatter';
import {
  fetchRatesInCascade,
  loadCachedRates,
  saveUserSessionState,
  loadUserSessionState,
} from '../services/rateService';

export default function CalculatorScreen() {
  const { isDark, colors, toggleTheme } = useTheme();

  // Moneda activa: 'USD' ("Dólar BCV") o 'EUR' ("Euro")
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [menuOpen, setMenuOpen] = useState(false);

  // Estado de tasas y metadatos
  const [ratesData, setRatesData] = useState({
    usd: 896.1225,
    eur: 1004.9566,
    trend: {
      USD: { diff: 1.23, pct: 0.14 },
      EUR: { diff: -1.08, pct: -0.11 },
    },
    formattedDate: 'Viernes, 06/11/2026',
    source: 'BCV Oficial',
    isOffline: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Estado numérico puro (float) y estado visual formateado (string)
  const [foreignValue, setForeignValue] = useState(1.0);
  const [vesValue, setVesValue] = useState(896.12);
  const [foreignDisplay, setForeignDisplay] = useState('1,00');
  const [vesDisplay, setVesDisplay] = useState('896,12');

  // Control de foco ("FOREIGN" | "VES" | null) para evitar bucles de re-renderizado
  const activeInputRef = useRef(null);
  const [focusedField, setFocusedField] = useState(null);

  // Feedback visual de copiado
  const [copiedField, setCopiedField] = useState(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [toastMessage, setToastMessage] = useState('');

  // Tasa activa según la divisa seleccionada
  const activeRate =
    selectedCurrency === 'USD' ? ratesData.usd : ratesData.eur;

  // Mostrar notificación minimalista al copiar
  const triggerToast = useCallback(
    (msg, fieldKey) => {
      setCopiedField(fieldKey);
      setToastMessage(msg);
      Animated.sequence([
        Animated.timing(toastOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.delay(1400),
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setCopiedField(null);
      });
    },
    [toastOpacity]
  );

  // Sincronización inicial Offline-First + Consulta en cascada
  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      // 1. Cargar caché local inmediatamente para respuesta instantánea
      const [cachedRates, savedSession] = await Promise.all([
        loadCachedRates(),
        loadUserSessionState(),
      ]);

      const initialCurrency =
        savedSession?.currency === 'EUR' ? 'EUR' : 'USD';
      const initialForeign =
        typeof savedSession?.foreignAmount === 'number' &&
        savedSession.foreignAmount > 0
          ? savedSession.foreignAmount
          : 1.0;

      if (isMounted) {
        setSelectedCurrency(initialCurrency);
        setForeignValue(initialForeign);
        setForeignDisplay(formatCurrencyDisplay(initialForeign));

        if (cachedRates) {
          setRatesData({ ...cachedRates, isOffline: true });
          const rateToUse =
            initialCurrency === 'USD' ? cachedRates.usd : cachedRates.eur;
          const computedVes = convertForeignToVes(initialForeign, rateToUse);
          setVesValue(computedVes);
          setVesDisplay(formatCurrencyDisplay(computedVes));
        }
      }

      // 2. Consultar APIs en cascada en segundo plano
      const freshRates = await fetchRatesInCascade();
      if (isMounted && freshRates) {
        setRatesData(freshRates);
        const rateToUse =
          initialCurrency === 'USD' ? freshRates.usd : freshRates.eur;
        const computedVes = convertForeignToVes(initialForeign, rateToUse);
        setVesValue(computedVes);
        setVesDisplay(formatCurrencyDisplay(computedVes));
        setIsLoading(false);
      }
    };

    initialize();
    return () => {
      isMounted = false;
    };
  }, []);

  // Recalcular automáticamente cuando cambia la divisa (USD <-> EUR) o se actualiza la tasa
  useEffect(() => {
    if (!activeRate || activeRate <= 0) return;

    if (activeInputRef.current === 'VES') {
      const updatedForeign = convertVesToForeign(vesValue, activeRate);
      setForeignValue(updatedForeign);
      setForeignDisplay(formatCurrencyDisplay(updatedForeign));
    } else {
      const updatedVes = convertForeignToVes(foreignValue, activeRate);
      setVesValue(updatedVes);
      setVesDisplay(formatCurrencyDisplay(updatedVes));
    }
  }, [selectedCurrency, activeRate]);

  // Manejador de edición en el input de Divisa ($ o €)
  const handleForeignChange = (text) => {
    if (activeInputRef.current !== 'FOREIGN') return;

    const { numericValue, displayValue } = parseLiveCurrencyInput(text);
    setForeignValue(numericValue);
    setForeignDisplay(displayValue);

    const calculatedVes = convertForeignToVes(numericValue, activeRate);
    setVesValue(calculatedVes);
    setVesDisplay(formatCurrencyDisplay(calculatedVes));

    saveUserSessionState({
      currency: selectedCurrency,
      foreignAmount: numericValue,
      lastEditedField: 'FOREIGN',
    });
  };

  // Manejador de edición en el input de Bolívares (Bs)
  const handleVesChange = (text) => {
    if (activeInputRef.current !== 'VES') return;

    const { numericValue, displayValue } = parseLiveCurrencyInput(text);
    setVesValue(numericValue);
    setVesDisplay(displayValue);

    const calculatedForeign = convertVesToForeign(numericValue, activeRate);
    setForeignValue(calculatedForeign);
    setForeignDisplay(formatCurrencyDisplay(calculatedForeign));

    saveUserSessionState({
      currency: selectedCurrency,
      foreignAmount: calculatedForeign,
      lastEditedField: 'VES',
    });
  };

  // Alternar entre Dólar BCV y Euro
  const handleSwitchCurrency = (targetCurrency) => {
    const next =
      targetCurrency || (selectedCurrency === 'USD' ? 'EUR' : 'USD');
    setSelectedCurrency(next);
    setMenuOpen(false);
    saveUserSessionState({
      currency: next,
      foreignAmount: foreignValue,
      lastEditedField: activeInputRef.current || 'FOREIGN',
    });
  };

  // Refrescar tasas manualmente
  const handleRefreshRates = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    const fresh = await fetchRatesInCascade();
    if (fresh) {
      setRatesData(fresh);
    }
    setIsRefreshing(false);
  };

  // Copiar valor al portapapeles con expo-clipboard
  const handleCopy = async (valueToCopy, label, fieldKey) => {
    try {
      await Clipboard.setStringAsync(valueToCopy);
      triggerToast(`${label} copiado: ${valueToCopy}`, fieldKey);
    } catch (_err) {
      // Silencioso
    }
  };

  // Restablecer rápidamente a 1,00 unidad de divisa
  const handleResetToOne = () => {
    activeInputRef.current = 'FOREIGN';
    const baseAmount = 1.0;
    const calculatedVes = convertForeignToVes(baseAmount, activeRate);
    setForeignValue(baseAmount);
    setForeignDisplay(formatCurrencyDisplay(baseAmount));
    setVesValue(calculatedVes);
    setVesDisplay(formatCurrencyDisplay(calculatedVes));
    saveUserSessionState({
      currency: selectedCurrency,
      foreignAmount: baseAmount,
      lastEditedField: 'FOREIGN',
    });
  };

  // Datos de tendencia para la moneda activa
  const currentTrend = ratesData.trend?.[selectedCurrency] || {
    diff: 0,
    pct: 0,
  };
  const isTrendNegative = currentTrend.diff < 0;
  const trendColor = isTrendNegative ? colors.trendDown : colors.trendUp;
  const trendIcon = isTrendNegative ? 'arrow-down' : 'arrow-up';
  const formattedDiff = `${currentTrend.diff > 0 ? '' : ''}${currentTrend.diff.toFixed(2)} Bs (${currentTrend.pct.toFixed(2)}%)`;

  return (
    <TouchableWithoutFeedback
      onPress={() => {
        Keyboard.dismiss();
        if (menuOpen) setMenuOpen(false);
      }}
    >
      <View
        style={[styles.screenContainer, { backgroundColor: colors.background }]}
      >
        <StatusBar style={isDark ? 'light' : 'dark'} />

        {/* Barra Superior Minimalista: Marca + Estado Offline + Switch Tema */}
        <View style={styles.headerBar}>
          <View style={styles.brandCluster}>
            <Text style={[styles.brandSubtitle, { color: colors.textMuted }]}>
              BARRETO
            </Text>
            <Text style={[styles.brandTitle, { color: colors.textPrimary }]}>
              al cambio
            </Text>
          </View>

          <View style={styles.headerActions}>
            {ratesData.isOffline && (
              <View
                style={[
                  styles.offlineBadge,
                  { backgroundColor: colors.offlineBadgeBg },
                ]}
              >
                <Feather
                  name="wifi-off"
                  size={12}
                  color={colors.offlineBadgeText}
                />
                <Text
                  style={[
                    styles.offlineBadgeText,
                    { color: colors.offlineBadgeText },
                  ]}
                >
                  Tasa Offline
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleRefreshRates}
              activeOpacity={0.7}
              style={[
                styles.iconActionButton,
                {
                  backgroundColor: colors.cardSurface,
                  borderColor: colors.cardBorder,
                },
              ]}
              accessibilityLabel="Actualizar tasa"
            >
              {isRefreshing || isLoading ? (
                <ActivityIndicator size="small" color={colors.accentGreen} />
              ) : (
                <Feather
                  name="refresh-cw"
                  size={17}
                  color={colors.textSecondary}
                />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={toggleTheme}
              activeOpacity={0.7}
              style={[
                styles.iconActionButton,
                {
                  backgroundColor: colors.cardSurface,
                  borderColor: colors.cardBorder,
                },
              ]}
              accessibilityLabel="Cambiar tema claro u oscuro"
            >
              <Feather
                name={isDark ? 'sun' : 'moon'}
                size={18}
                color={isDark ? '#FBBF24' : '#3B4252'}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Contenedor Exterior Estilo Imagen 3 (Bordes suaves, padding generoso) */}
        <View
          style={[
            styles.outerFrame,
            {
              backgroundColor: colors.outerSurface,
              borderColor: colors.cardBorder,
              shadowColor: colors.shadowColor,
              shadowOpacity: colors.shadowOpacity,
            },
          ]}
        >
          {/* Tarjeta Principal Estilo Imágenes 1 y 2 */}
          <View
            style={[
              styles.calculatorCard,
              {
                backgroundColor: colors.cardSurface,
                borderColor: colors.cardBorder,
                shadowColor: colors.shadowColor,
                shadowOpacity: colors.shadowOpacity,
              },
            ]}
          >
            {/* Selector Superior: Botón Verde Redondeado + Menú de 3 puntos */}
            <View style={styles.selectorRow}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => handleSwitchCurrency()}
                style={[
                  styles.currencyPillButton,
                  { backgroundColor: colors.accentGreen },
                ]}
              >
                <Text
                  style={[
                    styles.currencyPillText,
                    { color: colors.accentGreenText },
                  ]}
                >
                  {selectedCurrency === 'USD' ? 'Dólar BCV' : 'Euro'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.6}
                onPress={() => setMenuOpen((prev) => !prev)}
                style={styles.dotsMenuTrigger}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <MaterialCommunityIcons
                  name="dots-vertical"
                  size={24}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            {/* Menú Flotante Minimalista (Inspirado en el popover de Imagen 3) */}
            {menuOpen && (
              <View
                style={[
                  styles.floatingPopover,
                  {
                    backgroundColor: colors.cardSurface,
                    borderColor: colors.cardBorder,
                    shadowColor: colors.shadowColor,
                  },
                ]}
              >
                <Pressable
                  onPress={() => handleSwitchCurrency('USD')}
                  style={styles.popoverItem}
                >
                  <Feather
                    name="dollar-sign"
                    size={15}
                    color={
                      selectedCurrency === 'USD'
                        ? colors.accentGreen
                        : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.popoverItemText,
                      {
                        color: colors.textPrimary,
                        fontWeight: selectedCurrency === 'USD' ? '700' : '500',
                      },
                    ]}
                  >
                    Dólar BCV (USD)
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => handleSwitchCurrency('EUR')}
                  style={styles.popoverItem}
                >
                  <MaterialCommunityIcons
                    name="currency-eur"
                    size={16}
                    color={
                      selectedCurrency === 'EUR'
                        ? colors.accentGreen
                        : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.popoverItemText,
                      {
                        color: colors.textPrimary,
                        fontWeight: selectedCurrency === 'EUR' ? '700' : '500',
                      },
                    ]}
                  >
                    Euro BCV (EUR)
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    handleResetToOne();
                    setMenuOpen(false);
                  }}
                  style={styles.popoverItem}
                >
                  <Feather
                    name="rotate-ccw"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.popoverItemText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Restablecer a 1,00
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Fila de Input 1: Moneda Extranjera ($ o €) */}
            <View style={styles.inputsSection}>
              <View
                style={[
                  styles.inputFieldContainer,
                  {
                    borderBottomColor:
                      focusedField === 'FOREIGN'
                        ? colors.inputUnderlineActive
                        : colors.inputUnderline,
                  },
                ]}
              >
                <Text
                  style={[styles.currencySymbol, { color: colors.textPrimary }]}
                >
                  {selectedCurrency === 'USD' ? '$' : '€'}
                </Text>

                <TextInput
                  style={[styles.amountInput, { color: colors.textPrimary }]}
                  value={foreignDisplay}
                  onFocus={() => {
                    activeInputRef.current = 'FOREIGN';
                    setFocusedField('FOREIGN');
                  }}
                  onBlur={() => {
                    if (focusedField === 'FOREIGN') setFocusedField(null);
                  }}
                  onChangeText={handleForeignChange}
                  keyboardType="numeric"
                  placeholder="0,00"
                  placeholderTextColor={colors.textMuted}
                  selectTextOnFocus
                  maxLength={20}
                />

                <TouchableOpacity
                  onPress={() =>
                    handleCopy(
                      foreignDisplay,
                      selectedCurrency === 'USD' ? 'USD' : 'EUR',
                      'FOREIGN'
                    )
                  }
                  activeOpacity={0.5}
                  style={[
                    styles.copyButton,
                    copiedField === 'FOREIGN' && styles.copyButtonActive,
                  ]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MaterialCommunityIcons
                    name={
                      copiedField === 'FOREIGN'
                        ? 'check-bold'
                        : 'content-copy'
                    }
                    size={22}
                    color={
                      copiedField === 'FOREIGN'
                        ? colors.accentGreen
                        : colors.textMuted
                    }
                  />
                </TouchableOpacity>
              </View>

              {/* Fila de Input 2: Bolívares (Bs) */}
              <View
                style={[
                  styles.inputFieldContainer,
                  {
                    borderBottomColor:
                      focusedField === 'VES'
                        ? colors.inputUnderlineActive
                        : colors.inputUnderline,
                  },
                ]}
              >
                <Text
                  style={[styles.currencySymbol, { color: colors.textPrimary }]}
                >
                  Bs
                </Text>

                <TextInput
                  style={[styles.amountInput, { color: colors.textPrimary }]}
                  value={vesDisplay}
                  onFocus={() => {
                    activeInputRef.current = 'VES';
                    setFocusedField('VES');
                  }}
                  onBlur={() => {
                    if (focusedField === 'VES') setFocusedField(null);
                  }}
                  onChangeText={handleVesChange}
                  keyboardType="numeric"
                  placeholder="0,00"
                  placeholderTextColor={colors.textMuted}
                  selectTextOnFocus
                  maxLength={22}
                />

                <TouchableOpacity
                  onPress={() => handleCopy(vesDisplay, 'Bs', 'VES')}
                  activeOpacity={0.5}
                  style={[
                    styles.copyButton,
                    copiedField === 'VES' && styles.copyButtonActive,
                  ]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MaterialCommunityIcons
                    name={
                      copiedField === 'VES' ? 'check-bold' : 'content-copy'
                    }
                    size={22}
                    color={
                      copiedField === 'VES'
                        ? colors.accentGreen
                        : colors.textMuted
                    }
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Barra de Tendencia (Flecha + Variación en Bs y %) */}
            <View
              style={[
                styles.infoPillBar,
                {
                  backgroundColor: colors.elevatedPill,
                  borderColor: colors.elevatedPillBorder,
                },
              ]}
            >
              <Feather
                name={trendIcon}
                size={18}
                color={trendColor}
                style={styles.trendArrowIcon}
              />
              <Text style={[styles.trendValueText, { color: trendColor }]}>
                {formattedDiff}
              </Text>
            </View>

            {/* Barra de Fecha Valor + Icono de Calendario */}
            <View
              style={[
                styles.infoPillBar,
                styles.datePillBar,
                {
                  backgroundColor: colors.elevatedPill,
                  borderColor: colors.elevatedPillBorder,
                },
              ]}
            >
              <Text style={[styles.dateText, { color: colors.textPrimary }]}>
                {ratesData.formattedDate}
              </Text>
              <MaterialCommunityIcons
                name="calendar-month-outline"
                size={19}
                color={colors.textMuted}
                style={styles.calendarIcon}
              />
            </View>
          </View>

          {/* Pie de Tarjeta Minimalista (Estilo Imagen 3: barra inferior limpia con metadatos y atajo rápido) */}
          <View style={styles.cardFooterMeta}>
            <View style={styles.footerSourceGroup}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: ratesData.isOffline
                      ? '#F59E0B'
                      : colors.accentGreen,
                  },
                ]}
              />
              <Text
                style={[styles.footerMetaText, { color: colors.textSecondary }]}
              >
                1 {selectedCurrency} = {formatCurrencyDisplay(activeRate)} Bs
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleResetToOne}
              activeOpacity={0.65}
              style={styles.resetChip}
            >
              <Feather
                name="rotate-ccw"
                size={12}
                color={colors.textSecondary}
              />
              <Text
                style={[styles.resetChipText, { color: colors.textSecondary }]}
              >
                Base 1,00
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Toast Flotante de Copiado */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toastContainer,
            {
              backgroundColor: colors.toastBg,
              opacity: toastOpacity,
            },
          ]}
        >
          <Feather name="check-circle" size={15} color={colors.accentGreen} />
          <Text style={[styles.toastText, { color: colors.toastText }]}>
            {toastMessage}
          </Text>
        </Animated.View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 64 : 48,
    paddingBottom: 28,
    justifyContent: 'center',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  brandCluster: {
    flexDirection: 'column',
  },
  brandSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.2,
    marginBottom: 1,
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 5,
  },
  offlineBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  iconActionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerFrame: {
    borderRadius: 32,
    padding: 14,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 8,
  },
  calculatorCard: {
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 24,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 28,
  },
  currencyPillButton: {
    width: '78%',
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencyPillText: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  dotsMenuTrigger: {
    position: 'absolute',
    right: 2,
    padding: 4,
  },
  floatingPopover: {
    position: 'absolute',
    top: 66,
    right: 18,
    zIndex: 30,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
    minWidth: 185,
  },
  popoverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 10,
  },
  popoverItemText: {
    fontSize: 14,
  },
  inputsSection: {
    gap: 22,
    marginBottom: 24,
  },
  inputFieldContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2.5,
    paddingBottom: 8,
  },
  currencySymbol: {
    fontSize: 27,
    fontWeight: '700',
    minWidth: 44,
    letterSpacing: -0.5,
  },
  amountInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '500',
    textAlign: 'right',
    paddingVertical: 4,
    paddingHorizontal: 10,
    fontVariant: ['tabular-nums'],
  },
  copyButton: {
    paddingLeft: 6,
    paddingVertical: 4,
    opacity: 0.85,
  },
  copyButtonActive: {
    opacity: 1,
    transform: [{ scale: 1.08 }],
  },
  infoPillBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  datePillBar: {
    justifyContent: 'center',
    marginBottom: 0,
    gap: 10,
  },
  trendArrowIcon: {
    marginLeft: 4,
  },
  trendValueText: {
    fontSize: 17,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  dateText: {
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  calendarIcon: {
    marginLeft: 2,
  },
  cardFooterMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 2,
  },
  footerSourceGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  footerMetaText: {
    fontSize: 12.5,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  resetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  resetChipText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  toastContainer: {
    position: 'absolute',
    bottom: 34,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  toastText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
