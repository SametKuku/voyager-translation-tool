
import { VoyagerTranslation, TranslationGroup } from '../types';

/**
 * Robust SQL parser for Laravel Voyager translations table.
 * Handles large bulk INSERTs and complex escaping correctly.
 */
export const parseVoyagerSQL = (sql: string): VoyagerTranslation[] => {
  const translations: VoyagerTranslation[] = [];

  const insertPrefixRegex = /INSERT INTO\s+[`"]?translations[`"]?\s+\(([^)]+)\)\s+VALUES\s*/gi;
  let match;

  while ((match = insertPrefixRegex.exec(sql)) !== null) {
    const columns = match[1].split(',').map(c => c.trim().replace(/[`"']/g, ''));
    const startIdx = match.index + match[0].length;

    let inTuple = false;
    let inQuote = false;
    let quoteChar = '';
    let currentToken = '';
    let currentRowValues: string[] = [];

    for (let i = startIdx; i < sql.length; i++) {
      const char = sql[i];

      if (char === ';' && !inQuote && !inTuple) break;

      if (inQuote) {
        if (char === quoteChar) {
          if (i + 1 < sql.length && sql[i + 1] === quoteChar) {
            currentToken += char;
            i++;
          } else {
            inQuote = false;
          }
        } else if (char === '\\') {
          if (i + 1 < sql.length) {
            const nextChar = sql[i + 1];
            if (nextChar === quoteChar || nextChar === '\\' || nextChar === '"') {
              currentToken += nextChar;
              i++;
            } else if (nextChar === 'n') {
              currentToken += '\n';
              i++;
            } else if (nextChar === 'r') {
              currentToken += '\r';
              i++;
            } else {
              currentToken += char;
            }
          } else {
            currentToken += char;
          }
        } else {
          currentToken += char;
        }
      } else {
        if (char === '(' && !inTuple) {
          inTuple = true;
          currentRowValues = [];
          currentToken = '';
        } else if (char === ')' && inTuple) {
          inTuple = false;
          currentRowValues.push(currentToken.trim());
          currentToken = '';
          processRow(currentRowValues, columns, translations);
        } else if (char === ',' && inTuple) {
          currentRowValues.push(currentToken.trim());
          currentToken = '';
        } else if ((char === "'" || char === '"' || char === '`') && inTuple) {
          inQuote = true;
          quoteChar = char;
        } else if (inTuple) {
          currentToken += char;
        }
      }
    }
  }

  return translations;
};

const processRow = (values: string[], columns: string[], translations: VoyagerTranslation[]) => {
  const row: any = {};

  const cleanedValues = values.map(v => {
    if (v.toUpperCase() === 'NULL') return null;
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      return v.slice(1, -1);
    }
    return v;
  });

  columns.forEach((col, idx) => {
    if (idx < cleanedValues.length) {
      row[col] = cleanedValues[idx];
    }
  });

  if (row.table_name && row.locale) {
    translations.push({
      table_name: row.table_name,
      column_name: row.column_name,
      foreign_key: row.foreign_key,
      locale: row.locale,
      value: row.value || '',
    });
  }
};

/**
 * Detects all unique locales in the parsed data.
 * Returns { sourceLang, otherLangs } where sourceLang is the most common locale (usually 'en').
 */
export const detectLanguages = (list: VoyagerTranslation[]): { sourceLang: string; allLangs: string[] } => {
  const counts: Record<string, number> = {};
  list.forEach(t => {
    counts[t.locale] = (counts[t.locale] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const allLangs = sorted.map(e => e[0]);

  // 'en' is always preferred as source if present, otherwise take the most frequent
  const sourceLang = allLangs.includes('en') ? 'en' : allLangs[0] ?? 'en';

  return { sourceLang, allLangs };
};

/**
 * Groups translations by (table_name, column_name, foreign_key).
 * Source language rows become group.source, all others go into group.translations map.
 */
export const groupTranslations = (list: VoyagerTranslation[], sourceLang = 'en'): TranslationGroup[] => {
  const map = new Map<string, TranslationGroup>();

  list.forEach(item => {
    const key = `${item.table_name}:${item.column_name}:${item.foreign_key}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        source: { ...item, locale: sourceLang, value: '' },
        translations: {},
      });
    }
    const group = map.get(key)!;

    if (item.locale === sourceLang) {
      group.source = item;
    } else {
      group.translations[item.locale] = item;
    }
  });

  return Array.from(map.values()).filter(g => g.source && g.source.value);
};

/**
 * Generates SQL for given target locales only.
 */
export const generateSQL = (groups: TranslationGroup[], targetLocales: string[]): string => {
  let sql = "-- Voyager Auto-Generated Translations\n";
  sql += "SET AUTOCOMMIT = 0;\nSTART TRANSACTION;\n\n";

  groups.forEach(group => {
    targetLocales.forEach(locale => {
      const data = group.translations[locale];
      if (data && data.value) {
        const escapedValue = data.value.replace(/'/g, "''").replace(/\\/g, "\\\\");
        sql += `DELETE FROM translations WHERE table_name = '${group.source.table_name}' AND column_name = '${group.source.column_name}' AND foreign_key = '${group.source.foreign_key}' AND locale = '${locale}';\n`;
        sql += `INSERT INTO translations (table_name, column_name, foreign_key, locale, value, created_at, updated_at) VALUES ('${group.source.table_name}', '${group.source.column_name}', '${group.source.foreign_key}', '${locale}', '${escapedValue}', NOW(), NOW());\n`;
      }
    });
  });

  sql += "\nCOMMIT;\nSET AUTOCOMMIT = 1;";
  return sql;
};
