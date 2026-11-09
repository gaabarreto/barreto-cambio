/**
 * Utilidades de formateo monetario venezolano (ej. 1.000.000,00) y
 * aritmética de punto flotante con redondeo bancario exacto.
 */

/**
 * Redondea de forma segura evitando imprecisiones IEEE 754 (ej. 1.005 -> 1.01)
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
export const safeRound = (value, decimals = 2) => {
  if (!Number.isFinite(value) || isNaN(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/**
 * Convierte de Divisa ($ / €) a Bolívares (Bs) con precisión controlada
 * @param {number} foreignAmount
 * @param {number} rate
 * @returns {number}
 */
export const convertForeignToVes = (foreignAmount, rate) => {
  if (!Number.isFinite(foreignAmount) || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }
  return safeRound(foreignAmount * rate, 2);
};

/**
 * Convierte de Bolívares (Bs) a Divisa ($ / €) evitando errores de precisión en división
 * @param {number} vesAmount
 * @param {number} rate
 * @returns {number}
 */
export const convertVesToForeign = (vesAmount, rate) => {
  if (!Number.isFinite(vesAmount) || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }
  // Multiplicamos a enteros de alta precisión antes de dividir para mitigar errores de punto flotante
  const scaledVes = Math.round(vesAmount * 1e6);
  const scaledRate = Math.round(rate * 1e6);
  if (scaledRate === 0) return 0;
  const rawDivision = scaledVes / scaledRate;
  return safeRound(rawDivision, 2);
};

/**
 * Formatea un número puro (float) al formato visual venezolano: 1.000.000,00
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
export const formatCurrencyDisplay = (value, decimals = 2) => {
  if (value === null || value === undefined || isNaN(value)) {
    return '0,00';
  }
  const rounded = safeRound(Number(value), decimals);
  const fixed = Math.abs(rounded).toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${formattedInt},${decPart}`;
};

/**
 * Procesa el texto ingresado por el usuario en tiempo real (modo máscara bancaria o edición libre con coma/punto)
 * y devuelve tanto el valor float puro para el estado como el string formateado para la vista.
 *
 * Soporta dos modos intuitivos:
 * - Si el usuario escribe dígitos, formatea con separador de miles (.) y decimales (,).
 * @param {string} rawInput
 * @returns {{ numericValue: number, displayValue: string }}
 */
export const parseLiveCurrencyInput = (rawInput) => {
  if (!rawInput || typeof rawInput !== 'string') {
    return { numericValue: 0, displayValue: '' };
  }

  // Extraer únicamente dígitos para comportamiento tipo calculadora bancaria fluida (centavos automáticos)
  // Ej: escribir "100" -> "1,00", "100000" -> "1.000,00"
  const digitsOnly = rawInput.replace(/\D/g, '');

  if (!digitsOnly || /^0+$/.test(digitsOnly)) {
    return { numericValue: 0, displayValue: '0,00' };
  }

  // Limitar a 15 dígitos para no desbordar Number.MAX_SAFE_INTEGER
  const cleanDigits = digitsOnly.slice(0, 15);
  const numericValue = safeRound(parseInt(cleanDigits, 10) / 100, 2);
  const displayValue = formatCurrencyDisplay(numericValue, 2);

  return { numericValue, displayValue };
};
