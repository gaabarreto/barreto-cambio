import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeRound } from '../utils/currencyFormatter';

const STORAGE_KEYS = {
  CACHED_RATES: '@barreto_cambio_rates_v1',
  LAST_INPUT_STATE: '@barreto_cambio_last_input_v1',
};

const ENDPOINTS = {
  PRIMARY: 'https://datos.cromstudio.com.ve/tasa',
  BACKUP_1: 'https://bcv.today/api/v1/rate.json',
  BACKUP_2: 'https://rates.dolarvzla.com/bcv/previous.json',
};

const FETCH_TIMEOUT_MS = 6500;

/**
 * Fetch con timeout abortable para no bloquear la cascada si un servidor cuelga
 */
const fetchWithTimeout = async (url, timeout = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
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
 * Formatea una fecha ISO (YYYY-MM-DD) o texto a formato elegante en español:
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
    if (!rawDate) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      return `${days[now.getDay()]}, ${dd}/${mm}/${yyyy}`;
    }

    // Si viene en formato YYYY-MM-DD
    const isoMatch = String(rawDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
      const dayName = days[dateObj.getDay()] || 'Fecha';
      return `${dayName}, ${day}/${month}/${year}`;
    }

    // Si viene en formato verbal de CromStudio: "Miércoles, 04 Noviembre  2026"
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
    const verbalMatch = String(rawDate).match(
      /([A-Za-záéíóúÁÉÍÓÚñÑ]+),?\s+(\d{1,2})\s+(?:de\s+)?([A-Za-záéíóúÁÉÍÓÚñÑ]+)\s+(\d{4})/i
    );
    if (verbalMatch) {
      const [, dayLabel, dayNum, monthName, yearNum] = verbalMatch;
      const mm = monthsMap[monthName.toLowerCase()] || '01';
      const dd = String(dayNum).padStart(2, '0');
      const capitalizedDay =
        dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1).toLowerCase();
      return `${capitalizedDay}, ${dd}/${mm}/${yearNum}`;
    }

    return String(rawDate);
  } catch (_err) {
    return 'Fecha oficial BCV';
  }
};

/**
 * Adaptador defensivo 1: API Principal (https://datos.cromstudio.com.ve/tasa)
 * Estructura esperada: { fuente: "BCV_DB", fecha_valor: "...", tasas: { USD: 893.21, EUR: 999.76 } }
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

    return {
      usd,
      eur,
      formattedDate: formatSpanishDate(
        data?.fecha_valor || data?.actualizado_el
      ),
      source: 'CromStudio BCV',
    };
  } catch (_e) {
    return null;
  }
};

/**
 * Adaptador defensivo 2: API Respaldo 1 (https://bcv.today/api/v1/rate.json)
 * Estructura esperada: { USD: 896.1225, EUR: 1004.9565, effective_date: "2026-11-06", date: "2026-11-08" }
 */
const parseBackup1Api = (data) => {
  try {
    const usd = toSafeFloat(data?.USD ?? data?.usd ?? data?.rates?.USD);
    const eur = toSafeFloat(data?.EUR ?? data?.eur ?? data?.rates?.EUR);
    if (!usd || !eur) return null;

    return {
      usd,
      eur,
      formattedDate: formatSpanishDate(
        data?.effective_date || data?.date || data?.updated_at
      ),
      source: 'BCV Today',
    };
  } catch (_e) {
    return null;
  }
};

/**
 * Adaptador defensivo 3: API Respaldo 2 (https://rates.dolarvzla.com/bcv/previous.json)
 * Estructura esperada:
 * {
 *   current: { date: "2026-11-06", usd: 896.1225, eur: 1004.9565 },
 *   previous: { date: "2026-11-05", usd: 894.8876, eur: 1006.0326 },
 *   changePercentage: { usd: 0.1379, eur: -0.1069 }
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

    return {
      usd: currentUsd,
      eur: currentEur,
      previousUsd: prevUsd,
      previousEur: prevEur,
      trend: {
        USD: { diff: usdDiff, pct: usdPct },
        EUR: { diff: eurDiff, pct: eurPct },
      },
      formattedDate: formatSpanishDate(data?.current?.date),
      source: 'DolarVzla BCV',
    };
  } catch (_e) {
    return null;
  }
};

/**
 * Calcula tendencia contra la tasa previa o la última guardada en caché
 */
const computeTrendFallback = (currentUsd, currentEur, cachedData) => {
  const prevUsd = cachedData?.previousUsd || cachedData?.usd || currentUsd;
  const prevEur = cachedData?.previousEur || cachedData?.eur || currentEur;

  const usdDiff = safeRound(currentUsd - prevUsd, 2);
  const eurDiff = safeRound(currentEur - prevEur, 2);

  const usdPct =
    prevUsd > 0 ? safeRound(((currentUsd - prevUsd) / prevUsd) * 100, 2) : 0;
  const eurPct =
    prevEur > 0 ? safeRound(((currentEur - prevEur) / prevEur) * 100, 2) : 0;

  return {
    USD: { diff: usdDiff, pct: usdPct },
    EUR: { diff: eurDiff, pct: eurPct },
  };
};

/**
 * Consulta las APIs en cascada (Principal -> Respaldo 1 -> Respaldo 2).
 * Además, intenta enriquecer el indicador de variación (tendencia) si está disponible
 * en Respaldo 2 o contra el caché local, sin interrumpir nunca al usuario.
 */
export const fetchRatesInCascade = async () => {
  const cached = await loadCachedRates();
  let primaryResult = null;

  // 1. Intentar API Principal
  try {
    const rawPrimary = await fetchWithTimeout(ENDPOINTS.PRIMARY);
    primaryResult = parsePrimaryApi(rawPrimary);
  } catch (_err) {
    // Continúa silenciosamente a Respaldo 1
  }

  // 2. Si falla Principal, intentar API Respaldo 1
  if (!primaryResult) {
    try {
      const rawBackup1 = await fetchWithTimeout(ENDPOINTS.BACKUP_1);
      primaryResult = parseBackup1Api(rawBackup1);
    } catch (_err) {
      // Continúa silenciosamente a Respaldo 2
    }
  }

  // 3. Consultar Respaldo 2 (ya sea como fallback final o para obtener la tendencia exacta del día anterior)
  let backup2Result = null;
  try {
    const rawBackup2 = await fetchWithTimeout(ENDPOINTS.BACKUP_2);
    backup2Result = parseBackup2Api(rawBackup2);
  } catch (_err) {
    // Silencioso
  }

  if (!primaryResult && backup2Result) {
    primaryResult = backup2Result;
  }

  // Si al menos una API respondió con éxito:
  if (primaryResult) {
    let trend = primaryResult.trend;

    // Si la API ganadora (Principal o Respaldo 1) no incluye histórico de variación,
    // calculamos la variación exacta usando el histórico de Respaldo 2 o el caché previo.
    if (!trend) {
      if (backup2Result?.previousUsd && backup2Result?.previousEur) {
        const prevUsd = backup2Result.previousUsd;
        const prevEur = backup2Result.previousEur;
        trend = {
          USD: {
            diff: safeRound(primaryResult.usd - prevUsd, 2),
            pct: safeRound(((primaryResult.usd - prevUsd) / prevUsd) * 100, 2),
          },
          EUR: {
            diff: safeRound(primaryResult.eur - prevEur, 2),
            pct: safeRound(((primaryResult.eur - prevEur) / prevEur) * 100, 2),
          },
        };
      } else {
        trend = computeTrendFallback(
          primaryResult.usd,
          primaryResult.eur,
          cached
        );
      }
    }

    const finalPayload = {
      usd: primaryResult.usd,
      eur: primaryResult.eur,
      previousUsd: backup2Result?.previousUsd || cached?.usd || primaryResult.usd,
      previousEur: backup2Result?.previousEur || cached?.eur || primaryResult.eur,
      trend,
      formattedDate: primaryResult.formattedDate,
      source: primaryResult.source,
      updatedAt: new Date().toISOString(),
      isOffline: false,
    };

    await saveCachedRates(finalPayload);
    return finalPayload;
  }

  // 4. Si las 3 APIs fallan, retornar caché Offline-First o semilla segura
  if (cached) {
    return {
      ...cached,
      isOffline: true,
    };
  }

  // Semilla inicial de emergencia si se abre por primera vez totalmente sin internet
  return {
    usd: 896.12,
    eur: 1004.96,
    previousUsd: 894.89,
    previousEur: 1006.03,
    trend: {
      USD: { diff: 1.23, pct: 0.14 },
      EUR: { diff: -1.08, pct: -0.11 },
    },
    formattedDate: formatSpanishDate(new Date().toISOString().slice(0, 10)),
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

/**
 * Guarda la última cantidad ingresada y moneda seleccionada por el usuario
 */
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
