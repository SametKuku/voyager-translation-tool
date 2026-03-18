
import { VoyagerTranslation, TranslationGroup } from '../types';

// System tables that should not be treated as content sources
const SYSTEM_TABLES = new Set([
  'translations', 'users', 'roles', 'permissions', 'permission_role',
  'migrations', 'data_rows', 'data_types', 'menus', 'menu_items',
  'settings', 'failed_jobs', 'personal_access_tokens', 'password_resets',
]);

/**
 * Generic SQL row parser — handles quoted strings, backslash escapes, NULL.
 */
const parseSqlValues = (sql: string, startIdx: number): { rows: Array<Record<string, string | null>>; columns: string[] } | null => {
  // Find column names from INSERT INTO ... (col1, col2, ...)
  const headerMatch = /INSERT INTO\s+[`"]?\w+[`"]?\s+\(([^)]+)\)\s+VALUES\s*/i.exec(sql.slice(Math.max(0, startIdx - 500), startIdx + 10));
  if (!headerMatch) return null;

  const columns = headerMatch[1].split(',').map(c => c.trim().replace(/[`"']/g, ''));
  const rows: Array<Record<string, string | null>> = [];

  let inTuple = false;
  let inQuote = false;
  let quoteChar = '';
  let currentToken = '';
  let currentRowValues: (string | null)[] = [];

  for (let i = startIdx; i < sql.length; i++) {
    const char = sql[i];
    if (char === ';' && !inQuote && !inTuple) break;

    if (inQuote) {
      if (char === quoteChar) {
        if (i + 1 < sql.length && sql[i + 1] === quoteChar) { currentToken += char; i++; }
        else inQuote = false;
      } else if (char === '\\' && i + 1 < sql.length) {
        const next = sql[i + 1];
        if (next === quoteChar || next === '\\' || next === '"') { currentToken += next; i++; }
        else if (next === 'n') { currentToken += '\n'; i++; }
        else if (next === 'r') { currentToken += '\r'; i++; }
        else currentToken += char;
      } else {
        currentToken += char;
      }
    } else {
      if (char === '(' && !inTuple) {
        inTuple = true; currentRowValues = []; currentToken = '';
      } else if (char === ')' && inTuple) {
        inTuple = false;
        currentRowValues.push(currentToken.trim() || null);
        currentToken = '';
        const row: Record<string, string | null> = {};
        columns.forEach((col, idx) => {
          const v = currentRowValues[idx];
          if (v === null || v?.toUpperCase() === 'NULL') { row[col] = null; }
          else { row[col] = v; }
        });
        rows.push(row);
      } else if (char === ',' && inTuple) {
        currentRowValues.push(currentToken.trim() || null);
        currentToken = '';
      } else if ((char === "'" || char === '"' || char === '`') && inTuple) {
        inQuote = true; quoteChar = char;
      } else if (inTuple) {
        currentToken += char;
      }
    }
  }

  return { rows, columns };
};

/**
 * Parses ALL model table INSERT statements (skips system tables).
 * Returns a map: "tableName:id:columnName" -> value
 */
export const parseAllTables = (sql: string): Map<string, string> => {
  const modelData = new Map<string, string>();

  const insertRegex = /INSERT INTO\s+[`"]?(\w+)[`"]?\s+\(([^)]+)\)\s+VALUES\s*/gi;
  let match: RegExpExecArray | null;

  while ((match = insertRegex.exec(sql)) !== null) {
    const tableName = match[1];
    if (SYSTEM_TABLES.has(tableName)) continue;

    const columns = match[2].split(',').map(c => c.trim().replace(/[`"']/g, ''));
    const idColIndex = columns.indexOf('id');
    if (idColIndex === -1) continue;

    const startIdx = match.index + match[0].length;
    const result = parseSqlValues(sql, startIdx);
    if (!result) continue;

    for (const row of result.rows) {
      const rowId = row['id'];
      if (!rowId) continue;
      columns.forEach(col => {
        const val = row[col];
        if (val && val.trim() && val.toUpperCase() !== 'NULL') {
          modelData.set(`${tableName}:${rowId}:${col}`, val);
        }
      });
    }
  }

  return modelData;
};

/**
 * Parses only the `translations` table from the SQL dump.
 */
export const parseVoyagerSQL = (sql: string): VoyagerTranslation[] => {
  const translations: VoyagerTranslation[] = [];
  const insertPrefixRegex = /INSERT INTO\s+[`"]?translations[`"]?\s+\(([^)]+)\)\s+VALUES\s*/gi;
  let match: RegExpExecArray | null;

  while ((match = insertPrefixRegex.exec(sql)) !== null) {
    const columns = match[1].split(',').map(c => c.trim().replace(/[`"']/g, ''));
    const startIdx = match.index + match[0].length;
    let inTuple = false, inQuote = false, quoteChar = '', currentToken = '';
    let currentRowValues: string[] = [];

    for (let i = startIdx; i < sql.length; i++) {
      const char = sql[i];
      if (char === ';' && !inQuote && !inTuple) break;

      if (inQuote) {
        if (char === quoteChar) {
          if (i + 1 < sql.length && sql[i + 1] === quoteChar) { currentToken += char; i++; }
          else inQuote = false;
        } else if (char === '\\' && i + 1 < sql.length) {
          const next = sql[i + 1];
          if (next === quoteChar || next === '\\' || next === '"') { currentToken += next; i++; }
          else if (next === 'n') { currentToken += '\n'; i++; }
          else if (next === 'r') { currentToken += '\r'; i++; }
          else currentToken += char;
        } else {
          currentToken += char;
        }
      } else {
        if (char === '(' && !inTuple) {
          inTuple = true; currentRowValues = []; currentToken = '';
        } else if (char === ')' && inTuple) {
          inTuple = false;
          currentRowValues.push(currentToken.trim());
          currentToken = '';
          processTranslationRow(currentRowValues, columns, translations);
        } else if (char === ',' && inTuple) {
          currentRowValues.push(currentToken.trim());
          currentToken = '';
        } else if ((char === "'" || char === '"' || char === '`') && inTuple) {
          inQuote = true; quoteChar = char;
        } else if (inTuple) {
          currentToken += char;
        }
      }
    }
  }

  return translations;
};

const processTranslationRow = (values: string[], columns: string[], translations: VoyagerTranslation[]) => {
  const row: any = {};
  const cleanedValues = values.map(v => {
    if (v.toUpperCase() === 'NULL') return null;
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) return v.slice(1, -1);
    return v;
  });
  columns.forEach((col, idx) => { if (idx < cleanedValues.length) row[col] = cleanedValues[idx]; });
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
 * Detects all unique locales in the translations table.
 */
export const detectLanguages = (list: VoyagerTranslation[]): { sourceLang: string; allLangs: string[] } => {
  const counts: Record<string, number> = {};
  list.forEach(t => { counts[t.locale] = (counts[t.locale] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const allLangs = sorted.map(e => e[0]);
  const sourceLang = allLangs[0] ?? 'en';
  return { sourceLang, allLangs };
};

/**
 * Checks if the SQL dump contains model table data that could serve as a source language.
 * Returns the likely model content language code if detectable, or null.
 * Heuristic: checks for Turkish-specific characters in a sample of model table values.
 */
export const detectModelLanguage = (modelData: Map<string, string>): string | null => {
  if (modelData.size === 0) return null;

  const turkishPattern = /[ğüşıöçĞÜŞİÖÇ]/;
  let sampleCount = 0;
  let turkishHits = 0;

  for (const [, value] of modelData) {
    if (sampleCount >= 100) break;
    if (value && value.length > 5) {
      sampleCount++;
      if (turkishPattern.test(value)) turkishHits++;
    }
  }

  if (sampleCount === 0) return null;
  if (turkishHits / sampleCount > 0.2) return 'tr';
  return null;
};

/**
 * Groups translations. If sourceLang is not in translations table,
 * tries to find source values from model tables (modelData).
 */
export const groupTranslations = (
  list: VoyagerTranslation[],
  sourceLang = 'en',
  modelData?: Map<string, string>
): TranslationGroup[] => {
  const map = new Map<string, TranslationGroup>();

  // First pass: build groups from translations table
  list.forEach(item => {
    const key = `${item.table_name}:${item.column_name}:${item.foreign_key}`;
    if (!map.has(key)) {
      map.set(key, { key, source: { ...item, locale: sourceLang, value: '' }, translations: {} });
    }
    const group = map.get(key)!;
    if (item.locale === sourceLang) {
      group.source = item;
    } else {
      group.translations[item.locale] = item;
    }
  });

  // Second pass: if source value is empty and modelData exists, look up from model tables
  if (modelData && modelData.size > 0) {
    map.forEach(group => {
      if (!group.source.value) {
        const modelKey = `${group.source.table_name}:${group.source.foreign_key}:${group.source.column_name}`;
        const modelValue = modelData.get(modelKey);
        if (modelValue) {
          group.source = { ...group.source, locale: sourceLang, value: modelValue };
        }
      }
    });
  }

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
