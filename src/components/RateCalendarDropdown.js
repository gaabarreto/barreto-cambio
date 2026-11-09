import React, { useState, useMemo, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { formatCurrencyDisplay } from '../utils/currencyFormatter';

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * Calendario desplegable minimalista estilo Apple (Imagen 3)
 * Muestra los días del mes, marca con un punto verde las fechas con publicación oficial BCV,
 * y permite navegar por meses y seleccionar cualquier fecha para calcular a esa tasa.
 */
export default function RateCalendarDropdown({
  visible,
  selectedIsoDate,
  latestPublishedIso,
  todayIso,
  selectedCurrency,
  historyMap,
  colors,
  onSelectDate,
  onMonthChange,
  onClose,
}) {
  const initialParts = (selectedIsoDate || '2026-11-06').split('-');
  const [viewYear, setViewYear] = useState(Number(initialParts[0]) || 2026);
  const [viewMonth, setViewMonth] = useState(Number(initialParts[1]) || 11); // 1-12
  const [loadingMonth, setLoadingMonth] = useState(false);

  useEffect(() => {
    if (selectedIsoDate) {
      const [y, m] = selectedIsoDate.split('-');
      if (y && m) {
        setViewYear(Number(y));
        setViewMonth(Number(m));
      }
    }
  }, [selectedIsoDate]);

  // Construir la cuadrícula de días del mes activo (Lunes a Domingo)
  const calendarCells = useMemo(() => {
    const firstDayObj = new Date(viewYear, viewMonth - 1, 1);
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();

    // Convertir getDay() (0=Dom..6=Sáb) a índice Lunes=0..Domingo=6
    const startWeekday = (firstDayObj.getDay() + 6) % 7;

    const cells = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push(null);
    }

    const mm = String(viewMonth).padStart(2, '0');
    for (let day = 1; day <= daysInMonth; day++) {
      const dd = String(day).padStart(2, '0');
      const iso = `${viewYear}-${mm}-${dd}`;
      const exactEntry = historyMap?.[iso] || null;
      cells.push({
        day,
        iso,
        exactEntry,
      });
    }

    return cells;
  }, [viewYear, viewMonth, historyMap]);

  if (!visible) return null;

  const handlePrevMonth = async () => {
    let nextY = viewYear;
    let nextM = viewMonth - 1;
    if (nextM < 1) {
      nextM = 12;
      nextY -= 1;
    }
    setViewYear(nextY);
    setViewMonth(nextM);
    if (onMonthChange) {
      setLoadingMonth(true);
      await onMonthChange(nextY, nextM);
      setLoadingMonth(false);
    }
  };

  const handleNextMonth = async () => {
    let nextY = viewYear;
    let nextM = viewMonth + 1;
    if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    }
    setViewYear(nextY);
    setViewMonth(nextM);
    if (onMonthChange) {
      setLoadingMonth(true);
      await onMonthChange(nextY, nextM);
      setLoadingMonth(false);
    }
  };

  return (
    <View
      style={[
        styles.dropdownCard,
        {
          backgroundColor: colors.elevatedPill,
          borderColor: colors.cardBorder,
        },
      ]}
    >
      {/* Cabecera de Mes y Año con flechas de navegación */}
      <View style={styles.monthHeaderRow}>
        <TouchableOpacity
          onPress={handlePrevMonth}
          activeOpacity={0.65}
          style={[
            styles.navArrowBtn,
            { backgroundColor: colors.cardSurface, borderColor: colors.cardBorder },
          ]}
        >
          <Feather name="chevron-left" size={18} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.monthTitleWrap}>
          <Text style={[styles.monthTitleText, { color: colors.textPrimary }]}>
            {MONTH_NAMES[viewMonth - 1]} {viewYear}
          </Text>
          {loadingMonth && (
            <ActivityIndicator
              size="small"
              color={colors.accentGreen}
              style={styles.monthSpinner}
            />
          )}
        </View>

        <TouchableOpacity
          onPress={handleNextMonth}
          activeOpacity={0.65}
          style={[
            styles.navArrowBtn,
            { backgroundColor: colors.cardSurface, borderColor: colors.cardBorder },
          ]}
        >
          <Feather name="chevron-right" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Atajos rápidos: Hoy Vigente y Última Publicada (ej. Lunes si es fin de semana) */}
      <View style={styles.quickPillsRow}>
        {todayIso && (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => onSelectDate(todayIso)}
            style={[
              styles.quickPill,
              {
                backgroundColor: colors.cardSurface,
                borderColor:
                  selectedIsoDate === todayIso
                    ? colors.accentGreen
                    : colors.cardBorder,
              },
            ]}
          >
            <Text
              style={[
                styles.quickPillText,
                {
                  color:
                    selectedIsoDate === todayIso
                      ? colors.accentGreen
                      : colors.textSecondary,
                },
              ]}
            >
              Vigente hoy
            </Text>
          </TouchableOpacity>
        )}

        {latestPublishedIso && latestPublishedIso !== todayIso && (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => onSelectDate(latestPublishedIso)}
            style={[
              styles.quickPill,
              {
                backgroundColor: colors.cardSurface,
                borderColor:
                  selectedIsoDate === latestPublishedIso
                    ? colors.accentGreen
                    : colors.cardBorder,
              },
            ]}
          >
            <Text
              style={[
                styles.quickPillText,
                {
                  color:
                    selectedIsoDate === latestPublishedIso
                      ? colors.accentGreen
                      : colors.textSecondary,
                },
              ]}
            >
              Próxima BCV ({latestPublishedIso.slice(8, 10)}/
              {latestPublishedIso.slice(5, 7)})
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Cabecera de días de la semana */}
      <View style={styles.weekDaysHeader}>
        {WEEKDAYS.map((wd) => (
          <Text
            key={wd}
            style={[styles.weekDayLabel, { color: colors.textMuted }]}
          >
            {wd}
          </Text>
        ))}
      </View>

      {/* Cuadrícula de días */}
      <View style={styles.daysGrid}>
        {calendarCells.map((cell, idx) => {
          if (!cell) {
            return <View key={`empty-${idx}`} style={styles.dayCell} />;
          }

          const isSelected = cell.iso === selectedIsoDate;
          const hasOfficialRate = Boolean(cell.exactEntry);
          const maxKnownIso = latestPublishedIso || todayIso || '9999-12-31';
          const isFutureWithoutRate =
            cell.iso > maxKnownIso && !hasOfficialRate;

          const rateNumber = cell.exactEntry
            ? selectedCurrency === 'USD'
              ? cell.exactEntry.usd
              : cell.exactEntry.eur
            : null;

          return (
            <TouchableOpacity
              key={cell.iso}
              disabled={isFutureWithoutRate}
              activeOpacity={0.7}
              onPress={() => onSelectDate(cell.iso)}
              style={[
                styles.dayCell,
                isSelected && {
                  backgroundColor: colors.accentGreen,
                  borderRadius: 12,
                },
                !isSelected &&
                  hasOfficialRate && {
                    backgroundColor: colors.cardSurface,
                    borderRadius: 12,
                  },
                isFutureWithoutRate && { opacity: 0.28 },
              ]}
            >
              <Text
                style={[
                  styles.dayNumberText,
                  {
                    color: isSelected
                      ? colors.accentGreenText
                      : hasOfficialRate
                        ? colors.textPrimary
                        : colors.textMuted,
                    fontWeight:
                      isSelected || hasOfficialRate ? '700' : '400',
                  },
                ]}
              >
                {cell.day}
              </Text>

              {rateNumber ? (
                <Text
                  numberOfLines={1}
                  style={[
                    styles.dayRateMiniText,
                    {
                      color: isSelected
                        ? colors.accentGreenText
                        : colors.textSecondary,
                    },
                  ]}
                >
                  {formatCurrencyDisplay(rateNumber, 2)}
                </Text>
              ) : (
                <View style={styles.dayEmptySpacer} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Leyenda e botón de cerrar */}
      <View style={styles.calendarFooter}>
        <View style={styles.legendRow}>
          <View
            style={[
              styles.legendDot,
              { backgroundColor: colors.accentGreen },
            ]}
          />
          <Text style={[styles.legendText, { color: colors.textMuted }]}>
            Toca cualquier día para calcular con su tasa BCV
          </Text>
        </View>

        <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
          <Text style={[styles.closeCalendarBtn, { color: colors.textSecondary }]}>
            Cerrar
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dropdownCard: {
    marginTop: 10,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
  },
  monthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  navArrowBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  monthTitleText: {
    fontSize: 15.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  monthSpinner: {
    marginLeft: 4,
  },
  quickPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  quickPill: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  quickPillText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  weekDaysHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  weekDayLabel: {
    width: '13.8%',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    rowGap: 5,
  },
  dayCell: {
    width: '14.28%',
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumberText: {
    fontSize: 13.5,
  },
  dayRateMiniText: {
    fontSize: 8.5,
    fontWeight: '600',
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  dayEmptySpacer: {
    height: 11,
  },
  calendarFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 11,
  },
  closeCalendarBtn: {
    fontSize: 12,
    fontWeight: '700',
    paddingLeft: 8,
  },
});
