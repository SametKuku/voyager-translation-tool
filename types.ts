
export interface VoyagerTranslation {
  id?: number | string;
  table_name: string;
  column_name: string;
  foreign_key: string;
  locale: string;
  value: string;
  created_at?: string;
  updated_at?: string;
}

export enum ProcessStatus {
  IDLE = 'IDLE',
  PARSING = 'PARSING',
  TRANSLATING = 'TRANSLATING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface ProcessingLog {
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface TranslationGroup {
  key: string; // table_name:column_name:foreign_key
  en: VoyagerTranslation;
  es?: VoyagerTranslation;
  ru?: VoyagerTranslation;
}
