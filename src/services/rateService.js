import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeRound } from '../utils/currencyFormatter';

const STORAGE_KEYS = {
  CACHED_RATES: '@barreto_cambio_rates_v3',
  CACHED_HISTORY: '@barreto_cambio_history_v3',
  LAST_INPUT_STATE: '@barreto_cambio_last_input_v1',
};

const ENDPOINTS = {
  PRIMARY: 'https://datos.cromstudio.com.ve/tasa',
  BACKUP_1: 'https://bcv.today/api/v1/rate.json',
  BACKUP_2: 'https://rates.dolarvzla.com/bcv/previous.json',
  DOLARVZLA_CURRENT: 'https://rates.dolarvzla.com/bcv/current.json',
  BCV_TODAY_HISTORY: 'https://bcv.today/api/v1/history.json',
  dolarVzlaMonthList: (year, month) =>
    `https://rates.dolarvzla.com/bcv/${Number(year)}/${Number(month)}/list.json`,
  dolarVzlaYearList: (year) =>
    `https://rates.dolarvzla.com/bcv/${Number(year)}/list.json`,
};

const FETCH_TIMEOUT_MS = 6500;

/**
 * Fetch con timeout abortable y cache-busting para datos siempre frescos
 */
const fetchWithTimeout = async (url, timeout = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const separator = url.includes('?') ? '&' : '?';
    const freshUrl = `${url}${separator}_t=${Date.now()}`;
    const response = await fetch(freshUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
};

/**
 * Convierte cualquier valor potencial a float positivo de forma segura
 */
const toSafeFloat = (val) => {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    return val;
  }
  if (typeof val === 'string') {
    const normalized = val.replace(',', '.').trim();
    const parsed = parseFloat(normalized);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};

/**
 * Extrae una fecha canónica ISO (YYYY-MM-DD) desde cualquier formato ("2026-11-06" o "Miércoles, 04 Noviembre 2026")
 */
export const extractIsoDate = (rawDate) => {
  if (!rawDate) return null;

  const str = String(rawDate).trim();
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const monthsMap = {
    enero: '01',
    febrero: '02',
    marzo: '03',
    abril: '04',
    mayo: '05',
    junio: '06',
    julio: '07',
    agosto: '08',
    septiembre: '09',
    octubre: '10',
    noviembre: '11',
    diciembre: '12',
  };

  const verbalMatch = str.match(
    /([A-Za-záéíóúÁÉÍÓÚñÑ]+),?\s+(\d{1,2})\s+(?:de\s+)?([A-Za-záéíóúÁÉÍÓÚñÑ]+)\s+(\d{4})/i
  );
  if (verbalMatch) {
    const [, , dayNum, monthName, yearNum] = verbalMatch;
    const mm = monthsMap[monthName.toLowerCase()];
    if (mm) {
      const dd = String(dayNum).padStart(2, '0');
      return `${yearNum}-${mm}-${dd}`;
    }
  }

  return null;
};

/**
 * Formatea una fecha ISO (YYYY-MM-DD) o texto al formato de las Imágenes 1 y 2:
 * "Viernes, 06/11/2026"
 */
export const formatSpanishDate = (rawDate) => {
  const days = [
    'Domingo',
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
  ];

  try {
    const iso = extractIsoDate(rawDate);
    if (iso) {
      const [year, month, day] = iso.split('-');
      const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
      const dayName = days[dateObj.getDay()] || 'Fecha';
      return `${dayName}, ${day}/${month}/${year}`;
    }

    if (!rawDate) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      return `${days[now.getDay()]}, ${dd}/${mm}/${yyyy}`;
    }

    return String(rawDate);
  } catch (_err) {
    return 'Fecha oficial BCV';
  }
};

/**
 * Calcula tendencia (diferencia en Bs y %) entre dos cortes de tasa
 */
export const computeTrend = (currentUsd, currentEur, prevUsd, prevEur) => {
  const baseUsd = prevUsd && prevUsd > 0 ? prevUsd : currentUsd;
  const baseEur = prevEur && prevEur > 0 ? prevEur : currentEur;

  const usdDiff = safeRound(currentUsd - baseUsd, 2);
  const eurDiff = safeRound(currentEur - baseEur, 2);

  const usdPct =
    baseUsd > 0 ? safeRound(((currentUsd - baseUsd) / baseUsd) * 100, 2) : 0;
  const eurPct =
    baseEur > 0 ? safeRound(((currentEur - baseEur) / baseEur) * 100, 2) : 0;

  return {
    USD: { diff: usdDiff, pct: usdPct },
    EUR: { diff: eurDiff, pct: eurPct },
  };
};

/**
 * Adaptador defensivo 1: API Principal (https://datos.cromstudio.com.ve/tasa)
 */
const parsePrimaryApi = (data) => {
  try {
    const usd = toSafeFloat(
      data?.tasas?.USD ?? data?.tasas?.usd ?? data?.USD ?? data?.usd
    );
    const eur = toSafeFloat(
      data?.tasas?.EUR ?? data?.tasas?.eur ?? data?.EUR ?? data?.eur
    );
    if (!usd || !eur) return null;

    const rawDate = data?.fecha_valor || data?.actualizado_el;
    const isoDate =
      extractIsoDate(data?.fecha_valor) ||
      extractIsoDate(data?.actualizado_el) ||
      null;
    if (!isoDate) return null;

    return [{ isoDate, usd, eur, source: 'CromStudio BCV' }];
  } catch (_e) {
    return null;
  }
};

/**
 * Adaptador defensivo 2: API Respaldo 1 (https://bcv.today/api/v1/rate.json)
 */
const parseBackup1Api = (data) => {
  try {
    const usd = toSafeFloat(data?.USD ?? data?.usd ?? data?.rates?.USD);
    const eur = toSafeFloat(data?.EUR ?? data?.eur ?? data?.rates?.EUR);
    if (!usd || !eur) return null;

    const isoDate =
      extractIsoDate(data?.effective_date) ||
      extractIsoDate(data?.date) ||
      extractIsoDate(data?.updated_at) ||
      null;
    if (!isoDate) return null;

    return [{ isoDate, usd, eur, source: 'BCV Today' }];
  } catch (_e) {
    return null;
  }
};

/**
 * Adaptador defensivo 3: Snapshot con current + previous (previous.json y current.json de DolarVzla)
 */
const parseSnapshotApi = (data) => {
  try {
    const entries = [];
    const curUsd = toSafeFloat(data?.current?.usd ?? data?.current?.USD);
    const curEur = toSafeFloat(data?.current?.eur ?? data?.current?.EUR);
    const curIso = extractIsoDate(data?.current?.date);

    if (curUsd && curEur && curIso) {
      entries.push({
        isoDate: curIso,
        usd: curUsd,
        eur: curEur,
        source: 'DolarVzla BCV',
      });
    }

    const prevUsd = toSafeFloat(data?.previous?.usd ?? data?.previous?.USD);
    const prevEur = toSafeFloat(data?.previous?.eur ?? data?.previous?.EUR);
    const prevIso = extractIsoDate(data?.previous?.date);

    if (prevUsd && prevEur && prevIso) {
      entries.push({
        isoDate: prevIso,
        usd: prevUsd,
        eur: prevEur,
        source: 'DolarVzla BCV',
      });
    }

    return entries.length > 0 ? entries : null;
  } catch (_e) {
    return null;
  }
};

/**
 * Adaptador defensivo para listas históricas (rates.dolarvzla.com/bcv/{year}/list.json o bcv.today/api/v1/history.json)
 */
const parseHistoryList = (list) => {
  try {
    if (!Array.isArray(list)) return [];
    const results = [];
    for (const item of list) {
      const usd = toSafeFloat(item?.usd ?? item?.USD);
      const eur = toSafeFloat(item?.eur ?? item?.EUR);
      const isoDate =
        extractIsoDate(item?.date) || extractIsoDate(item?.effective_date);
      if (usd && eur && isoDate) {
        results.push({
          isoDate,
          usd,
          eur,
          source: 'Historial BCV',
        });
      }
    }
    return results;
  } catch (_e) {
    return [];
  }
};

/**
 * Construye un mapa indexado por fecha YYYY-MM-DD con su variación exacta respecto a la jornada hábil previa
 */
export const buildHistoryIndex = (entriesArray, existingMap = {}) => {
  const merged = { ...existingMap };

  for (const item of entriesArray) {
    if (!item?.isoDate || !item?.usd || !item?.eur) continue;
    merged[item.isoDate] = {
      isoDate: item.isoDate,
      usd: item.usd,
      eur: item.eur,
      formattedDate: formatSpanishDate(item.isoDate),
      source: item.source || 'BCV Oficial',
    };
  }

  // Ordenar todas las fechas ascendentemente para calcular la variación de cada día contra su día hábil inmediato anterior
  const sortedDates = Object.keys(merged).sort((a, b) => a.localeCompare(b));

  for (let i = 0; i < sortedDates.length; i++) {
    const iso = sortedDates[i];
    const currentEntry = merged[iso];
    const prevEntry = i > 0 ? merged[sortedDates[i - 1]] : currentEntry;

    currentEntry.previousIsoDate = prevEntry.isoDate;
    currentEntry.previousUsd = prevEntry.usd;
    currentEntry.previousEur = prevEntry.eur;
    currentEntry.trend = computeTrend(
      currentEntry.usd,
      currentEntry.eur,
      prevEntry.usd,
      prevEntry.eur
    );
  }

  return merged;
};

/**
 * Obtiene la tasa que aplica para cualquier fecha calendario YYYY-MM-DD:
 * - Si esa fecha exacta tiene publicación BCV, devuelve esa publicación.
 * - Si es fin de semana o feriado bancario (sin publicación propia), busca la tasa vigente publicada inmediata anterior,
 *   o si ya existe tasa publicada para el lunes siguiente, permite seleccionarla directamente.
 */
export const resolveRateForDate = (isoDate, historyMap) => {
  if (!historyMap || Object.keys(historyMap).length === 0) return null;
  if (historyMap[isoDate]) {
    return {
      ...historyMap[isoDate],
      selectedCalendarDate: isoDate,
      selectedCalendarFormatted: formatSpanishDate(isoDate),
    };
  }

  // Si el usuario toca un sábado/domingo/feriado sin tasa propia, buscar la última tasa publicada <= isoDate
  const allDatesDesc = Object.keys(historyMap).sort((a, b) =>
    b.localeCompare(a)
  );
  const effectiveIso = allDatesDesc.find((d) => d <= isoDate) || allDatesDesc[0];
  const entry = historyMap[effectiveIso];
  if (!entry) return null;

  return {
    ...entry,
    selectedCalendarDate: isoDate,
    selectedCalendarFormatted: formatSpanishDate(isoDate),
  };
};

/**
 * Carga bajo demanda el historial de un mes/año específico si el usuario navega a meses anteriores en el calendario
 */
export const fetchMonthHistoryIfNeeded = async (year, month, currentHistoryMap) => {
  try {
    const rawList = await fetchWithTimeout(
      ENDPOINTS.dolarVzlaMonthList(year, month)
    );
    const parsed = parseHistoryList(rawList);
    if (parsed.length > 0) {
      const updatedMap = buildHistoryIndex(parsed, currentHistoryMap);
      await saveCachedHistory(updatedMap);
      return updatedMap;
    }
  } catch (_err) {
    // Silencioso
  }
  return currentHistoryMap;
};

/**
 * Consulta en cascada las APIs principales y además sincroniza el historial completo del año
 * para poblar el calendario desplegable y mostrar la tasa vigente del día.
 */
export const fetchRatesInCascade = async () => {
  const [cachedRates, cachedHistory] = await Promise.all([
    loadCachedRates(),
    loadCachedHistory(),
  ]);

  const currentYear = new Date().getFullYear();

  const [
    resPrimary,
    resBackup1,
    resBackup2,
    resCurrent,
    resYearHistory,
    resBcvTodayHistory,
  ] = await Promise.allSettled([
    fetchWithTimeout(ENDPOINTS.PRIMARY),
    fetchWithTimeout(ENDPOINTS.BACKUP_1),
    fetchWithTimeout(ENDPOINTS.BACKUP_2),
    fetchWithTimeout(ENDPOINTS.DOLARVZLA_CURRENT),
    fetchWithTimeout(ENDPOINTS.dolarVzlaYearList(currentYear)),
    fetchWithTimeout(ENDPOINTS.BCV_TODAY_HISTORY),
  ]);

  const collectedEntries = [];

  if (resBcvTodayHistory.status === 'fulfilled') {
    // Tomamos los últimos 120 registros de bcv.today/history.json como respaldo histórico
    const list = Array.isArray(resBcvTodayHistory.value)
      ? resBcvTodayHistory.value.slice(-120)
      : [];
    collectedEntries.push(...parseHistoryList(list));
  }

  if (resYearHistory.status === 'fulfilled') {
    collectedEntries.push(...parseHistoryList(resYearHistory.value));
  }

  if (resPrimary.status === 'fulfilled') {
    const p1 = parsePrimaryApi(resPrimary.value);
    if (p1) collectedEntries.push(...p1);
  }

  if (resBackup1.status === 'fulfilled') {
    const b1 = parseBackup1Api(resBackup1.value);
    if (b1) collectedEntries.push(...b1);
  }

  if (resBackup2.status === 'fulfilled') {
    const b2 = parseSnapshotApi(resBackup2.value);
    if (b2) collectedEntries.push(...b2);
  }

  if (resCurrent.status === 'fulfilled') {
    const cur = parseSnapshotApi(resCurrent.value);
    if (cur) collectedEntries.push(...cur);
  }

  if (collectedEntries.length > 0) {
    const historyMap = buildHistoryIndex(
      collectedEntries,
      cachedHistory || {}
    );
    await saveCachedHistory(historyMap);

    const allDatesDesc = Object.keys(historyMap).sort((a, b) =>
      b.localeCompare(a)
    );

    // Determinar la fecha de hoy en hora de Venezuela (UTC-4)
    const nowVzla = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const todayIso = nowVzla.toISOString().slice(0, 10);

    // Seleccionar por defecto la tasa vigente de hoy (o si hoy es fin de semana y ya está publicada la del lunes, mostrar la más reciente disponible; y en el calendario todas las fechas son seleccionables)
    const defaultActiveIso =
      allDatesDesc.find((d) => d <= todayIso) || allDatesDesc[0];
    const latestPublishedIso = allDatesDesc[0];

    const defaultEntry =
      historyMap[defaultActiveIso] || historyMap[latestPublishedIso];

    const finalPayload = {
      ...defaultEntry,
      latestPublishedIso,
      todayIso,
      updatedAt: new Date().toISOString(),
      isOffline: false,
    };

    await saveCachedRates(finalPayload);
    return {
      activeRateData: finalPayload,
      historyMap,
    };
  }

  // Fallback Offline-First si no hay internet
  const fallbackHistory = cachedHistory || buildHistoryIndex([
    { isoDate: '2026-11-04', usd: 893.2173, eur: 999.7692 },
    { isoDate: '2026-11-05', usd: 894.8876, eur: 1006.0326 },
    { isoDate: '2026-11-06', usd: 896.1225, eur: 1004.9566 },
    { isoDate: '2026-11-09', usd: 897.5383, eur: 1001.186 },
  ]);

  const fallbackActive = cachedRates
    ? { ...cachedRates, isOffline: true }
    : {
        ...fallbackHistory['2026-11-06'],
        latestPublishedIso: '2026-11-09',
        todayIso: '2026-11-08',
        updatedAt: new Date().toISOString(),
        isOffline: true,
      };

  return {
    activeRateData: fallbackActive,
    historyMap: fallbackHistory,
  };
};

export const saveCachedRates = async (ratesPayload) => {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEYS.CACHED_RATES,
      JSON.stringify(ratesPayload)
    );
  } catch (_err) {}
};

export const loadCachedRates = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_RATES);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (toSafeFloat(parsed?.usd) && toSafeFloat(parsed?.eur)) {
      return parsed;
    }
    return null;
  } catch (_err) {
    return null;
  }
};

export const saveCachedHistory = async (historyMap) => {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEYS.CACHED_HISTORY,
      JSON.stringify(historyMap)
    );
  } catch (_err) {}
};

export const loadCachedHistory = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_HISTORY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
};

export const saveUserSessionState = async ({
  currency,
  foreignAmount,
  lastEditedField,
}) => {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEYS.LAST_INPUT_STATE,
      JSON.stringify({
        currency,
        foreignAmount: Number(foreignAmount) || 1,
        lastEditedField: lastEditedField || 'FOREIGN',
      })
    );
  } catch (_err) {}
};

export const loadUserSessionState = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.LAST_INPUT_STATE);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
};
