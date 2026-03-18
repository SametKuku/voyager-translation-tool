
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
  source: VoyagerTranslation; // source locale (usually 'en')
  translations: Record<string, VoyagerTranslation>; // locale -> data
}

export interface LanguageInfo {
  code: string;
  name: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { code: 'tr', name: 'Turkish',    flag: '🇹🇷' },
  { code: 'es', name: 'Spanish',    flag: '🇪🇸' },
  { code: 'ru', name: 'Russian',    flag: '🇷🇺' },
  { code: 'de', name: 'German',     flag: '🇩🇪' },
  { code: 'fr', name: 'French',     flag: '🇫🇷' },
  { code: 'ar', name: 'Arabic',     flag: '🇸🇦' },
  { code: 'zh', name: 'Chinese',    flag: '🇨🇳' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'it', name: 'Italian',    flag: '🇮🇹' },
  { code: 'ja', name: 'Japanese',   flag: '🇯🇵' },
  { code: 'ko', name: 'Korean',     flag: '🇰🇷' },
  { code: 'nl', name: 'Dutch',      flag: '🇳🇱' },
  { code: 'pl', name: 'Polish',     flag: '🇵🇱' },
  { code: 'uk', name: 'Ukrainian',  flag: '🇺🇦' },
];
