import { HASS, HassEntity, EntityConfig } from './types';
import { isUnavailable, secondsToDuration } from './helpers';

const formatNumber = (
  value: number,
  hass: HASS,
  options: Intl.NumberFormatOptions = {},
): string => {
  const lang = hass.locale?.language || 'en';
  try {
    return new Intl.NumberFormat(lang, options).format(value);
  } catch {
    return String(value);
  }
};

export const entityStateDisplay = (
  hass: HASS,
  stateObj: HassEntity | undefined,
  config: EntityConfig,
): string => {
  if (!stateObj) return '';
  if (isUnavailable(stateObj)) {
    return hass.localize(`state.default.${stateObj.state}`) || stateObj.state;
  }

  let rawValue: any = config.attribute
    ? stateObj.attributes[config.attribute]
    : stateObj.state;
  let unit =
    config.unit === false
      ? undefined
      : config.attribute !== undefined
        ? (config.unit as string | undefined)
        : (config.unit as string | undefined) || stateObj.attributes.unit_of_measurement;

  if (config.format) {
    // Upstream #225: a missing attribute (e.g. brightness on a light that's
    // off) is undefined, not a value — render it as empty text for the
    // string transforms and as 0 for the numeric formats, rather than
    // letting it flow through as the literal string "undefined".
    if (rawValue === undefined || rawValue === null) {
      rawValue = ['upper', 'lower', 'capitalize', 'title'].includes(config.format) ? '' : 0;
    }

    // Upstream #367: string-only format modes — operate on any value, not
    // just numbers. `title` matches letters after start/whitespace instead
    // of `\b\w` so non-ASCII words ("über") capitalize correctly.
    switch (config.format) {
      case 'upper':
        return `${String(rawValue).toUpperCase()}${unit ? ` ${unit}` : ''}`;
      case 'lower':
        return `${String(rawValue).toLowerCase()}${unit ? ` ${unit}` : ''}`;
      case 'capitalize': {
        const s = String(rawValue);
        return `${s.charAt(0).toUpperCase() + s.slice(1)}${unit ? ` ${unit}` : ''}`;
      }
      case 'title':
        return `${String(rawValue).replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase())}${unit ? ` ${unit}` : ''}`;
    }

    const numeric = parseFloat(rawValue);
    const isNumber = !isNaN(numeric) && isFinite(numeric);

    if (isNumber) {
      // Upstream #304: invert/position do arithmetic on the value before
      // formatting, which loses formatNumber's "preserve the source
      // string's decimal digits" handling. Compute the source value's
      // original decimal digit count so the formatted result keeps the
      // same precision as an unformatted display of the same value.
      const sourceDigits =
        typeof rawValue === 'string' && rawValue.includes('.')
          ? rawValue.split('.')[1].length
          : undefined;
      const sourceDigitsOptions =
        sourceDigits !== undefined
          ? { minimumFractionDigits: sourceDigits, maximumFractionDigits: sourceDigits }
          : undefined;

      switch (config.format) {
        case 'brightness':
          rawValue = Math.round((numeric / 255) * 100);
          unit = '%';
          break;
        case 'percent':
          // Upstream #323: value × 100 → x %
          rawValue = formatNumber(numeric * 100, hass, { maximumFractionDigits: 2 });
          unit = '%';
          break;
        case 'duration':
          rawValue = secondsToDuration(numeric);
          unit = undefined;
          break;
        case 'duration-m':
          rawValue = secondsToDuration(numeric / 1000);
          unit = undefined;
          break;
        case 'duration-h':
          rawValue = secondsToDuration(numeric * 3600);
          unit = undefined;
          break;
        case 'invert':
          rawValue = formatNumber(-numeric, hass, sourceDigitsOptions);
          break;
        case 'position':
          rawValue = formatNumber(100 - numeric, hass, sourceDigitsOptions);
          break;
        case 'celsius_to_fahrenheit':
          rawValue = formatNumber(numeric * 1.8 + 32, hass, { maximumFractionDigits: 0 });
          break;
        case 'fahrenheit_to_celsius':
          rawValue = formatNumber(((numeric - 32) * 5) / 9, hass, { maximumFractionDigits: 1 });
          break;
        default: {
          // Exact matches only — `startsWith` would misread typos like
          // `kilowatt` or `precisions` as valid formats.
          const precisionMatch = config.format.match(/^precision(\d)$/);
          const scaledMatch = config.format.match(/^(kilo|mega|milli)(\d?)$/);
          if (precisionMatch) {
            const precision = parseInt(precisionMatch[1], 10);
            rawValue = formatNumber(numeric, hass, {
              minimumFractionDigits: precision,
              maximumFractionDigits: precision,
            });
          } else if (scaledMatch) {
            // kilo/mega/milli on their own default to a 2-decimal cap; a
            // trailing digit (kilo3, mega1, milli0, ...) requests an exact
            // precision, same pattern as precision<0-9>.
            const divisor =
              scaledMatch[1] === 'kilo' ? 1000 : scaledMatch[1] === 'mega' ? 1000000 : 1 / 1000;
            const precision = scaledMatch[2] === '' ? undefined : parseInt(scaledMatch[2], 10);
            rawValue = formatNumber(
              numeric / divisor,
              hass,
              precision === undefined
                ? { maximumFractionDigits: 2 }
                : { minimumFractionDigits: precision, maximumFractionDigits: precision },
            );
          }
        }
      }
    }
    return `${rawValue}${unit ? ` ${unit}` : ''}`;
  }

  if (config.attribute) {
    if (hass.formatEntityAttributeValue) {
      const formatted = hass.formatEntityAttributeValue(stateObj, config.attribute, rawValue);
      return `${formatted}${unit ? ` ${unit}` : ''}`;
    }
    // Upstream #225/#352: a missing attribute is undefined, not a number or
    // a real string — render an empty value rather than the literal string
    // "undefined" (only reachable on HA versions without formatEntityAttributeValue).
    if (rawValue === undefined || rawValue === null) {
      return `${unit ? ` ${unit}` : ''}`;
    }
    const numeric = parseFloat(rawValue);
    const formatted = isNaN(numeric) ? String(rawValue) : formatNumber(numeric, hass);
    return `${formatted}${unit ? ` ${unit}` : ''}`;
  }

  const stateObjForFormat =
    unit !== stateObj.attributes.unit_of_measurement
      ? {
          ...stateObj,
          attributes: { ...stateObj.attributes, unit_of_measurement: unit },
        }
      : stateObj;

  if (hass.formatEntityState) {
    return hass.formatEntityState(stateObjForFormat);
  }
  return `${stateObjForFormat.state}${unit ? ` ${unit}` : ''}`;
};
