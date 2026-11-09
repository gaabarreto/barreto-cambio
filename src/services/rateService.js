import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeRound } from '../utils/currencyFormatter';

const STORAGE_KEYS = {
  CACHED_RATES: '@barreto_cambio_rates_v2',
  LAST_INPUT_STATE: '@barreto_cambio_last_input_v1',
};

const ENDPOINTS = {
  PRIMARY: 'https://datos.cromstudio.com.ve/tasa',
  BACKUP_1: 'https://bcv.today/api/v1/rate.json',
  BACKUP_2: 'https://rates.dolarvzla.com/bcv/previous.json',
};

const FETCH_TIMEOUT_MS = 6500;

/**
 * Fetch con timeout abortable y cache-busting para garantizar datos frescos día con día
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
 * para poder comparar qué API tiene la tasa más reciente del BCV.
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
 * Adaptador defensivo 1: API Principal (https://datos.cromstudio.com.ve/tasa)
 * Estructura: { fuente: "BCV_DB", fecha_valor: "Miércoles, 04 Noviembre  2026", tasas: { USD: 893.2173, EUR: 999.7691 } }
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
    const isoDate = extractIsoDate(data?.fecha_valor) || extractIsoDate(data?.actualizado_el) || '1970-01-01';

    return {
      usd,
      eur,
      isoDate,
      formattedDate: formatSpanishDate(rawDate),
      source: 'CromStudio BCV',
      priority: 1,
    };
  } catch (_e) {
    return null;
  }
};

/**
 * Adaptador defensivo 2: API Respaldo 1 (https://bcv.today/api/v1/rate.json)
 * Estructura: { USD: 896.1225, EUR: 1004.95657762, effective_date: "2026-11-06", date: "2026-11-08" }
 */
const parseBackup1Api = (data) => {
  try {
    const usd = toSafeFloat(data?.USD ?? data?.usd ?? data?.rates?.USD);
    const eur = toSafeFloat(data?.EUR ?? data?.eur ?? data?.rates?.EUR);
    if (!usd || !eur) return null;

    const rawDate = data?.effective_date || data?.date || data?.updated_at;
    const isoDate =
      extractIsoDate(data?.effective_date) ||
      extractIsoDate(data?.date) ||
      extractIsoDate(data?.updated_at) ||
      '1970-01-01';

    return {
      usd,
      eur,
      isoDate,
      formattedDate: formatSpanishDate(rawDate),
      source: 'BCV Today',
      priority: 2,
    };
  } catch (_e) {
    return null;
  }
};

/**
 * Adaptador defensivo 3: API Respaldo 2 con Historial (https://rates.dolarvzla.com/bcv/previous.json)
 * Estructura:
 * {
 *   current: { date: "2026-11-06", usd: 896.1225, eur: 1004.95657762 },
 *   previous: { date: "2026-11-05", usd: 894.8876, eur: 1006.03263992 },
 *   changePercentage: { usd: 0.1379949839510487, eur: -0.10696097296461061 }
 * }
 */
const parseBackup2Api = (data) => {
  try {
    const currentUsd = toSafeFloat(
      data?.current?.usd ?? data?.current?.USD ?? data?.usd
    );
    const currentEur = toSafeFloat(
      data?.current?.eur ?? data?.current?.EUR ?? data?.eur
    );
    if (!currentUsd || !currentEur) return null;

    const prevUsd = toSafeFloat(data?.previous?.usd ?? data?.previous?.USD);
    const prevEur = toSafeFloat(data?.previous?.eur ?? data?.previous?.EUR);
    const prevDateIso = extractIsoDate(data?.previous?.date);

    const usdDiff = prevUsd ? safeRound(currentUsd - prevUsd, 2) : 0;
    const eurDiff = prevEur ? safeRound(currentEur - prevEur, 2) : 0;

    const usdPct =
      typeof data?.changePercentage?.usd === 'number'
        ? safeRound(data.changePercentage.usd, 2)
        : prevUsd
          ? safeRound(((currentUsd - prevUsd) / prevUsd) * 100, 2)
          : 0;

    const eurPct =
      typeof data?.changePercentage?.eur === 'number'
        ? safeRound(data.changePercentage.eur, 2)
        : prevEur
          ? safeRound(((currentEur - prevEur) / prevEur) * 100, 2)
          : 0;

    const rawDate = data?.current?.date;
    const isoDate = extractIsoDate(rawDate) || '1970-01-01';

    return {
      usd: currentUsd,
      eur: currentEur,
      previousUsd: prevUsd,
      previousEur: prevEur,
      previousDateFormatted: prevDateIso ? formatSpanishDate(prevDateIso) : null,
      trend: {
        USD: { diff: usdDiff, pct: usdPct },
        EUR: { diff: eurDiff, pct: eurPct },
      },
      isoDate,
      formattedDate: formatSpanishDate(rawDate),
      source: 'DolarVzla BCV',
      priority: 3,
    };
  } catch (_e) {
    return null;
  }
};

/**
 * Calcula tendencia contra la tasa previa o la última guardada en caché
 */
const computeTrend = (currentUsd, currentEur, prevUsd, prevEur) => {
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
 * Consulta las 3 APIs y garantiza que SIEMPRE se utilice la tasa con la fecha de vigencia
 * más reciente del BCV (por ejemplo, si CromStudio se quedó congelada en el miércoles 04/11
 * pero BCV Today y DolarVzla ya tienen la tasa del viernes 06/11, selecciona automáticamente
 * la del viernes 06/11 y extrae el historial `current` vs `previous` de `rates.dolarvzla.com`).
 */
export const fetchRatesInCascade = async () => {
  const cached = await loadCachedRates();

  // Consultamos las 3 fuentes en paralelo de forma resiliente para comparar vigencia y obtener el historial
  const [resPrimary, resBackup1, resBackup2] = await Promise.allSettled([
    fetchWithTimeout(ENDPOINTS.PRIMARY),
    fetchWithTimeout(ENDPOINTS.BACKUP_1),
    fetchWithTimeout(ENDPOINTS.BACKUP_2),
  ]);

  const parsedPrimary =
    resPrimary.status === 'fulfilled' ? parsePrimaryApi(resPrimary.value) : null;
  const parsedBackup1 =
    resBackup1.status === 'fulfilled' ? parseBackup1Api(resBackup1.value) : null;
  const parsedBackup2 =
    resBackup2.status === 'fulfilled' ? parseBackup2Api(resBackup2.value) : null;

  const candidates = [parsedPrimary, parsedBackup1, parsedBackup2].filter(Boolean);

  if (candidates.length > 0) {
    // Ordenar candidatos por:
    // 1) Fecha de vigencia más reciente (isoDate descendente: "2026-11-06" > "2026-11-04")
    // 2) En caso de empate en la misma fecha del día, respetar el orden de prioridad (Principal -> Respaldo 1 -> Respaldo 2)
    candidates.sort((a, b) => {
      if (a.isoDate !== b.isoDate) {
        return b.isoDate.localeCompare(a.isoDate);
      }
      return a.priority - b.priority;
    });

    const freshest = candidates[0];

    // Determinar tasas previas del historial:
    // Si Respaldo 2 (DolarVzla) respondió y su fecha coincide con la tasa más reciente, usamos su `previous` oficial
    let prevUsd = parsedBackup2?.previousUsd;
    let prevEur = parsedBackup2?.previousEur;
    let prevDateFormatted = parsedBackup2?.previousDateFormatted || null;

    // Si la tasa más reciente es aún más nueva que el current de Respaldo 2, el current de Respaldo 2 pasa a ser la previa
    if (
      parsedBackup2 &&
      freshest.isoDate > parsedBackup2.isoDate
    ) {
      prevUsd = parsedBackup2.usd;
      prevEur = parsedBackup2.eur;
      prevDateFormatted = parsedBackup2.formattedDate;
    }

    if (!prevUsd || !prevEur) {
      prevUsd = cached?.previousUsd || cached?.usd || freshest.usd;
      prevEur = cached?.previousEur || cached?.eur || freshest.eur;
    }

    // Si la fecha coincide con Respaldo 2 y éste ya trae changePercentage exacto del BCV, lo usamos
    const trend =
      parsedBackup2 && parsedBackup2.isoDate === freshest.isoDate && parsedBackup2.trend
        ? parsedBackup2.trend
        : computeTrend(freshest.usd, freshest.eur, prevUsd, prevEur);

    const finalPayload = {
      usd: freshest.usd,
      eur: freshest.eur,
      previousUsd: prevUsd,
      previousEur: prevEur,
      previousDateFormatted: prevDateFormatted,
      trend,
      isoDate: freshest.isoDate,
      formattedDate: freshest.formattedDate,
      source: freshest.source,
      updatedAt: new Date().toISOString(),
      isOffline: false,
    };

    await saveCachedRates(finalPayload);
    return finalPayload;
  }

  // Fallback Offline-First si no hay conexión a ninguna de las 3 APIs
  if (cached) {
    return {
      ...cached,
      isOffline: true,
    };
  }

  return {
    usd: 896.1225,
    eur: 1004.9566,
    previousUsd: 894.8876,
    previousEur: 1006.0326,
    previousDateFormatted: 'Jueves, 05/11/2026',
    trend: {
      USD: { diff: 1.23, pct: 0.14 },
      EUR: { diff: -1.08, pct: -0.11 },
    },
    isoDate: '2026-11-06',
    formattedDate: 'Viernes, 06/11/2026',
    source: 'Memoria Local',
    updatedAt: new Date().toISOString(),
    isOffline: true,
  };
};

export const saveCachedRates = async (ratesPayload) => {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEYS.CACHED_RATES,
      JSON.stringify(ratesPayload)
    );
  } catch (_err) {
    // Silencioso
  }
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
  } catch (_err) {
    // Silencioso
  }
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
