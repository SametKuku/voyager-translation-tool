
import { VoyagerTranslation, TranslationGroup } from '../types';

/**
 * Robust SQL parser for Laravel Voyager translations table.
 * Handles large bulk INSERTs and complex escaping correctly.
 */
export const parseVoyagerSQL = (sql: string): VoyagerTranslation[] => {
  const translations: VoyagerTranslation[] = [];

  // Normalize SQL slightly to make finding start easier
  // We only care about the VALUES part of the INSERT INTO statement
  const insertPrefixRegex = /INSERT INTO\s+[`"]?translations[`"]?\s+\(([^)]+)\)\s+VALUES\s*/gi;
  let match;

  while ((match = insertPrefixRegex.exec(sql)) !== null) {
    const columns = match[1].split(',').map(c => c.trim().replace(/[`"']/g, ''));
    const startIdx = match.index + match[0].length;

    // Parse the VALUES part starting from startIdx
    let currentIndex = startIdx;
    let inTuple = false;
    let inQuote = false;
    let quoteChar = '';
    let currentToken = '';
    let currentRowValues: string[] = [];

    // Iterate through the SQL string from the VALUES start
    for (let i = startIdx; i < sql.length; i++) {
      const char = sql[i];
      const prevChar = i > 0 ? sql[i - 1] : '';

      // Stop if we hit a semicolon outside of quotes/tuples, marking end of statement
      if (char === ';' && !inQuote && !inTuple) {
        break;
      }

      if (inQuote) {
        // Checking for end of quote
        if (char === quoteChar) {
          // If double up (SQL standard), handle it
          if (i + 1 < sql.length && sql[i + 1] === quoteChar) {
            currentToken += char; // add one quote
            i++; // skip next
          } else {
            // End of quote
            inQuote = false;
          }
        } else if (char === '\\') {
          // Handle backslash escape (MySQL style)
          if (i + 1 < sql.length) {
            const nextChar = sql[i + 1];
            // If escaping the quote char, backslash, OR Double Quote (common in mixed content)
            if (nextChar === quoteChar || nextChar === '\\' || nextChar === '"') {
              currentToken += nextChar;
              i++;
            } else if (nextChar === 'n') {
              // Convert \n to real newline
              currentToken += '\n';
              i++;
            } else if (nextChar === 'r') {
              // Convert \r to real return
              currentToken += '\r';
              i++;
            } else {
              // Unknown escape, keep backslash (safer) or strip? 
              // Usually keeping it is safer unless we know exact rules.
              currentToken += char;
            }
          } else {
            currentToken += char;
          }
        } else {
          currentToken += char;
        }
      } else {
        // NOT in quote
        if (char === '(' && !inTuple) {
          inTuple = true;
          currentRowValues = [];
          currentToken = '';
        } else if (char === ')' && inTuple) {
          // End of tuple
          inTuple = false;
          // Push last valid token
          currentRowValues.push(currentToken.trim());
          currentToken = '';

          // Process the completed row
          processRow(currentRowValues, columns, translations);
        } else if (char === ',' && inTuple) {
          // Value separator
          currentRowValues.push(currentToken.trim());
          currentToken = '';
        } else if ((char === "'" || char === '"' || char === '`') && inTuple) {
          // Start of quote
          inQuote = true;
          quoteChar = char;
        } else if (inTuple) {
          currentToken += char;
        }
        // If not in tuple, we mostly ignore whitespace and commas between tuples
      }
    }
  }

  return translations;
};

const processRow = (values: string[], columns: string[], translations: VoyagerTranslation[]) => {
  const row: any = {};

  // Clean up values (remove surrounding quotes if simple strings, handle NULL)
  const cleanedValues = values.map(v => {
    if (v.toUpperCase() === 'NULL') return null;
    // If starts and ends with same quote, strip them
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

export const groupTranslations = (list: VoyagerTranslation[]): TranslationGroup[] => {
  const map = new Map<string, TranslationGroup>();

  list.forEach(item => {
    // Generate a unique key for the translation group
    const key = `${item.table_name}:${item.column_name}:${item.foreign_key}`;
    if (!map.has(key)) {
      // Initialize with default empty English structure if not found
      map.set(key, { key, en: { ...item, locale: 'en', value: '' } });
    }
    const group = map.get(key)!;

    // Assign value to the correct locale slot
    if (item.locale === 'en') group.en = item;
    else if (item.locale === 'es') group.es = item;
    else if (item.locale === 'ru') group.ru = item;
  });

  // Return all groups that have an English source value.
  // We assume 'en' is the source of truth for translation.
  return Array.from(map.values()).filter(g => g.en && g.en.value && g.en.locale === 'en');
};

export const generateSQL = (groups: TranslationGroup[]): string => {
  let sql = "-- Voyager Auto-Generated Translations\n";
  sql += "SET AUTOCOMMIT = 0;\nSTART TRANSACTION;\n\n";

  groups.forEach(group => {
    const targets = [
      { locale: 'es', data: group.es },
      { locale: 'ru', data: group.ru }
    ];

    targets.forEach(target => {
      if (target.data && target.data.value) {
        // Standard SQL escaping: replace single quote with two single quotes
        const escapedValue = target.data.value.replace(/'/g, "''").replace(/\\/g, "\\\\");

        // Optimize: Use REPLACE INTO or ON DUPLICATE KEY UPDATE if supported, but here acts as safe upsert
        sql += `DELETE FROM translations WHERE table_name = '${group.en.table_name}' AND column_name = '${group.en.column_name}' AND foreign_key = '${group.en.foreign_key}' AND locale = '${target.locale}';\n`;
        sql += `INSERT INTO translations (table_name, column_name, foreign_key, locale, value, created_at, updated_at) VALUES ('${group.en.table_name}', '${group.en.column_name}', '${group.en.foreign_key}', '${target.locale}', '${escapedValue}', NOW(), NOW());\n`;
      }
    });
  });

  sql += "\nCOMMIT;\nSET AUTOCOMMIT = 1;";
  return sql;
};
