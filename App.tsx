
import React, { useState, useCallback, useRef } from 'react';
import {
  VoyagerTranslation,
  ProcessStatus,
  ProcessingLog,
  TranslationGroup,
  SUPPORTED_LANGUAGES,
  LanguageInfo,
} from './types';
import {
  parseVoyagerSQL,
  parseAllTables,
  groupTranslations,
  generateSQL,
  detectLanguages,
  detectModelLanguage,
} from './services/sqlUtils';
import { translateBatch } from './services/lingvaService';
import { isGeminiAvailable, saveGeminiKey, testGeminiKey } from './services/geminiService';
import { translateComplexHtml } from './services/htmlTranslator';
import { slugify } from './services/textUtils';

const IconUpload = () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
const IconCheck = () => <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;
const IconLoading = () => <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getLangInfo = (code: string): LanguageInfo =>
  SUPPORTED_LANGUAGES.find(l => l.code === code) ?? { code, name: code.toUpperCase(), flag: '🌐' };

export default function App() {
  const [status, setStatus] = useState<ProcessStatus>(ProcessStatus.IDLE);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [groups, setGroups] = useState<TranslationGroup[]>([]);
  const [activeTab, setActiveTab] = useState<'preview' | 'logs' | 'export'>('preview');

  const [sourceLang, setSourceLang] = useState<string>('en');
  const [detectedLangs, setDetectedLangs] = useState<string[]>([]);
  const [targetLangs, setTargetLangs] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<VoyagerTranslation[]>([]);
  const [modelData, setModelData] = useState<Map<string, string>>(new Map());
  const [modelLang, setModelLang] = useState<string | null>(null);

  const [geminiActive, setGeminiActive] = useState<boolean>(isGeminiAvailable());
  const [progress, setProgress] = useState<{ done: number; total: number; lang: string } | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [apiKeySaved, setApiKeySaved] = useState<boolean>(false);
  const [apiKeyTesting, setApiKeyTesting] = useState<boolean>(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [apiKeyError, setApiKeyError] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const saved = localStorage.getItem('GEMINI_API_KEY');
    if (saved) {
      setApiKeyTesting(true);
      testGeminiKey(saved).then(result => {
        setApiKeyTesting(false);
        if (result.ok) {
          setApiKeyStatus('ok');
          setGeminiActive(true);
        } else {
          setApiKeyStatus('error');
          setApiKeyError(result.error ?? 'Geçersiz key.');
          setGeminiActive(false);
        }
      });
    }
  }, []);

  const addLog = useCallback((message: string, type: ProcessingLog['type'] = 'info') => {
    setLogs(prev => [{ timestamp: new Date(), message, type }, ...prev]);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus(ProcessStatus.PARSING);
    addLog(`Reading file: ${file.name}`);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      try {
        // Yield to UI before heavy parsing
        await sleep(0);
        const parsed = parseVoyagerSQL(content);
        addLog(`Successfully parsed ${parsed.length} rows from translations table.`);
        setParsedRows(parsed);

        // Parse all model tables for native-language source content
        addLog('Scanning model tables for native content...');
        await sleep(0);
        const mData = parseAllTables(content);
        setModelData(mData);
        addLog(`Found ${mData.size} model table values.`);

        const detectedNativeLang = detectModelLanguage(mData);
        setModelLang(detectedNativeLang);

        const { sourceLang: src, allLangs } = detectLanguages(parsed);
        const others = allLangs.filter(l => l !== src);

        // If model tables have a detectable language not in translations, prefer it as source
        const finalSrc = (detectedNativeLang && !allLangs.includes(detectedNativeLang))
          ? detectedNativeLang
          : src;

        setSourceLang(finalSrc);
        setDetectedLangs(allLangs);
        setTargetLangs(others);

        if (detectedNativeLang) {
          const nInfo = getLangInfo(detectedNativeLang);
          addLog(`Native content detected in model tables: ${nInfo.flag} ${nInfo.name} — set as source.`, 'success');
        } else {
          const srcInfo = getLangInfo(finalSrc);
          addLog(`Source language detected: ${srcInfo.flag} ${srcInfo.name} (${finalSrc.toUpperCase()})`, 'success');
        }
        if (others.length > 0) {
          addLog(`Existing translations found: ${others.map(l => getLangInfo(l).flag + ' ' + l.toUpperCase()).join(', ')}`, 'info');
        }

        const grouped = groupTranslations(parsed, finalSrc, mData);
        addLog(`Identified ${grouped.length} translation groups.`);

        setGroups(grouped);
        setStatus(ProcessStatus.IDLE);
      } catch (err) {
        addLog(`Error parsing SQL: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        setStatus(ProcessStatus.ERROR);
      }
    };
    reader.readAsText(file);
  };

  const toggleTargetLang = (code: string) => {
    setTargetLangs(prev =>
      prev.includes(code) ? prev.filter(l => l !== code) : [...prev, code]
    );
  };

  const changeSourceLang = (newSource: string, parsed: VoyagerTranslation[]) => {
    setSourceLang(newSource);
    const grouped = groupTranslations(parsed, newSource, modelData);
    setGroups(grouped);
    const others = detectedLangs.filter(l => l !== newSource);
    setTargetLangs(others);
    addLog(`Source language changed to ${getLangInfo(newSource).flag} ${getLangInfo(newSource).name.toUpperCase()}`, 'info');
  };

  const startTranslation = async () => {
    if (groups.length === 0 || targetLangs.length === 0) return;
    setStatus(ProcessStatus.TRANSLATING);
    addLog(`Starting translation with ${geminiActive ? 'Gemini AI' : 'Google Translate (GTX)'}...`);
    addLog(`Target languages: ${targetLangs.map(l => getLangInfo(l).flag + ' ' + l.toUpperCase()).join(', ')}`);

    const updatedGroups = [...groups];
    const batchSize = 50;
    const totalWork = updatedGroups.length * targetLangs.length;
    let doneWork = 0;

    try {
      for (const locale of targetLangs) {
        const langInfo = getLangInfo(locale);
        addLog(`Translating to ${langInfo.flag} ${langInfo.name}...`);

        let i = 0;
        while (i < updatedGroups.length) {
          const batch = updatedGroups.slice(i, i + batchSize);
          const currentBatchNum = Math.floor(i / batchSize) + 1;
          const totalBatches = Math.ceil(updatedGroups.length / batchSize);

          addLog(`[${langInfo.flag} ${locale.toUpperCase()}] Batch ${currentBatchNum}/${totalBatches} (${batch.length} items)...`);

          const HTML_TAG_RE = /<[a-zA-Z][^>]*>|<\/[a-zA-Z]+>/;
          const isComplexHtmlBatch = batch.some(g => HTML_TAG_RE.test(g.source.value));

          try {
            let translations: string[];

            if (isComplexHtmlBatch) {
              addLog(`Batch ${currentBatchNum}: HTML content detected, using safe mode...`);
              translations = [];
              for (const g of batch) {
                const cleanText = g.source.value.replace(/\\\\+n/g, '\n').replace(/\\n/g, '\n');
                translations.push(await translateComplexHtml(cleanText, locale));
              }
            } else {
              translations = await translateBatch(batch.map(g => g.source.value), locale);
            }

            batch.forEach((group, idx) => {
              let val = translations[idx] || group.source.value;
              if (group.source.column_name === 'slug') {
                // Pass source slug as fallback so slug is never empty
                val = slugify(val, group.source.value);
              }
              if (val) {
                group.translations[locale] = { ...group.source, locale, value: val };
              }
            });

            doneWork += batch.length;
            setProgress({ done: doneWork, total: totalWork, lang: `${langInfo.flag} ${locale.toUpperCase()}` });
            setGroups([...updatedGroups]);
            i += batchSize;
            await sleep(50);

          } catch (batchError: any) {
            const isRateLimit = batchError?.message?.includes('429');
            addLog(`Error in batch ${currentBatchNum}: ${batchError.message}`, 'error');
            if (isRateLimit) {
              addLog('Rate limit hit. Waiting 20 seconds...', 'warning');
              await sleep(20000);
            } else {
              addLog('Retrying in 5 seconds...', 'info');
              await sleep(5000);
            }
          }
        }

        addLog(`${langInfo.flag} ${langInfo.name} translation complete!`, 'success');
      }

      addLog('All translations finished!', 'success');
      setStatus(ProcessStatus.COMPLETED);
      setProgress(null);
      setActiveTab('export');
    } catch (error) {
      addLog(`Unexpected failure: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      setStatus(ProcessStatus.ERROR);
      setProgress(null);
    }
  };

  const resetAll = () => {
    setStatus(ProcessStatus.IDLE);
    setGroups([]);
    setLogs([]);
    setParsedRows([]);
    setModelData(new Map());
    setModelLang(null);
    setSourceLang('en');
    setDetectedLangs([]);
    setTargetLangs([]);
    setActiveTab('preview');
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadSQL = () => {
    const sql = generateSQL(groups, targetLangs);
    const blob = new Blob([sql], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voyager_translations_${new Date().toISOString().split('T')[0]}.sql`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('SQL File downloaded.', 'success');
  };

  const availableToAdd = SUPPORTED_LANGUAGES.filter(
    l => l.code !== sourceLang && !targetLangs.includes(l.code)
  );

  const completedCount = groups.filter(g => targetLangs.every(l => g.translations[l])).length;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight mb-2">
          Voyager <span className="text-indigo-600">Translator Pro</span>
        </h1>
        <p className="text-slate-500 max-w-2xl mx-auto">
          Automate your Laravel Voyager multi-language content. Upload a SQL dump, select target languages, and export.
        </p>
        <div className="mt-3 inline-flex items-center gap-2">
          {geminiActive ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block"></span>
              Gemini AI
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block"></span>
              Google Translate (GTX)
            </span>
          )}
          <span className="text-xs text-slate-400">Translation Engine</span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-4">

          {/* Control Center */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Control Center</h2>

            <div className="space-y-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={status === ProcessStatus.TRANSLATING}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 text-sm"
              >
                <IconUpload /> Upload SQL Dump
              </button>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".sql" />

              <button
                onClick={startTranslation}
                disabled={groups.length === 0 || targetLangs.length === 0 || status === ProcessStatus.TRANSLATING}
                className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 border-2 border-indigo-600 text-indigo-600 disabled:opacity-50 font-semibold rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
              >
                {status === ProcessStatus.TRANSLATING ? <><IconLoading /> Translating...</> : status === ProcessStatus.COMPLETED ? '↻ Re-translate' : 'Start Translation'}
              </button>

              {progress && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>{progress.lang}</span>
                    <span>{Math.round((progress.done / progress.total) * 100)}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(progress.done / progress.total) * 100}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-400 text-right">{progress.done} / {progress.total}</div>
                </div>
              )}

              {status === ProcessStatus.COMPLETED && (
                <button
                  onClick={downloadSQL}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-all shadow-sm text-sm"
                >
                  Download SQL
                </button>
              )}

              {(groups.length > 0 || status !== ProcessStatus.IDLE) && (
                <button
                  onClick={resetAll}
                  disabled={status === ProcessStatus.TRANSLATING}
                  className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-500 disabled:opacity-50 font-medium rounded-xl transition-all text-xs"
                >
                  ✕ Reset / New File
                </button>
              )}
            </div>

            {/* Stats */}
            <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
              <div className="bg-slate-50 p-2.5 rounded-lg text-center">
                <div className="text-xl font-bold text-indigo-600">{groups.length}</div>
                <div className="text-[10px] text-slate-500">Source Items</div>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg text-center">
                <div className="text-xl font-bold text-emerald-600">{completedCount}</div>
                <div className="text-[10px] text-slate-500">Completed</div>
              </div>
            </div>
          </div>

          {/* Language Manager */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Languages</h2>

            {/* Source Language */}
            <div className="mb-3">
              <p className="text-[10px] text-slate-400 font-semibold uppercase mb-1.5">
                Source Language
                {detectedLangs.length > 0 && (
                  <span className="ml-1 text-indigo-400 normal-case font-normal">(auto-detected)</span>
                )}
              </p>
              <select
                value={sourceLang}
                onChange={e => {
                  if (parsedRows.length > 0) {
                    changeSourceLang(e.target.value, parsedRows);
                  } else {
                    setSourceLang(e.target.value);
                  }
                }}
                className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700"
              >
                {SUPPORTED_LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>
                    {l.flag} {l.name} ({l.code.toUpperCase()})
                  </option>
                ))}
              </select>
              {modelLang === sourceLang && !detectedLangs.includes(sourceLang) && (
                <p className="text-[10px] text-emerald-600 mt-1">
                  ✓ Native content read from model tables.
                </p>
              )}
              {detectedLangs.length > 0 && !detectedLangs.includes(sourceLang) && modelLang !== sourceLang && (
                <p className="text-[10px] text-amber-500 mt-1">
                  ⚠ This language was not found in the SQL.
                </p>
              )}
            </div>

            {/* Target Languages */}
            <div className="mb-3">
              <p className="text-[10px] text-slate-400 font-semibold uppercase mb-1.5">Translate To</p>
              {targetLangs.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No target languages selected.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {targetLangs.map(code => {
                    const info = getLangInfo(code);
                    return (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium"
                      >
                        {info.flag} {code.toUpperCase()}
                        <button
                          onClick={() => toggleTargetLang(code)}
                          className="ml-0.5 hover:text-rose-500 transition-colors font-bold"
                        >×</button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Add Language */}
            {availableToAdd.length > 0 && (
              <div>
                <p className="text-[10px] text-slate-400 font-semibold uppercase mb-1.5">Add Language</p>
                <div className="flex flex-wrap gap-1.5">
                  {availableToAdd.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => toggleTargetLang(lang.code)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 border border-slate-200 hover:border-indigo-300 rounded-lg text-xs transition-all"
                    >
                      {lang.flag} {lang.code.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Gemini API Key */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Gemini API Key</h2>
            <div className="space-y-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={e => { setApiKeyInput(e.target.value); setApiKeySaved(false); setApiKeyStatus('idle'); }}
                placeholder={geminiActive ? '••••••••••••••••' : 'AIzaSy...'}
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 bg-slate-50 transition-colors ${
                  apiKeyStatus === 'ok' ? 'border-emerald-400 focus:ring-emerald-200' :
                  apiKeyStatus === 'error' ? 'border-rose-400 focus:ring-rose-200' :
                  'border-slate-200 focus:ring-indigo-300'
                }`}
              />
              {apiKeyStatus === 'ok' && (
                <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">✓ API key valid — Gemini active.</p>
              )}
              {apiKeyStatus === 'error' && (
                <p className="text-xs text-rose-600">✗ {apiKeyError}</p>
              )}
              <div className="flex gap-2">
                <button
                  disabled={!apiKeyInput.trim() || apiKeyTesting}
                  onClick={async () => {
                    setApiKeyTesting(true);
                    setApiKeyStatus('idle');
                    const result = await testGeminiKey(apiKeyInput);
                    setApiKeyTesting(false);
                    if (result.ok) {
                      saveGeminiKey(apiKeyInput);
                      setGeminiActive(true);
                      setApiKeySaved(true);
                      setApiKeyStatus('ok');
                      setApiKeyInput('');
                    } else {
                      setApiKeyStatus('error');
                      setApiKeyError(result.error ?? 'Geçersiz key.');
                    }
                  }}
                  className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-1"
                >
                  {apiKeyTesting ? <><IconLoading /> Testing...</> : apiKeySaved ? '✓ Saved' : 'Test & Save'}
                </button>
                {geminiActive && (
                  <button
                    onClick={() => {
                      saveGeminiKey('');
                      setGeminiActive(false);
                      setApiKeySaved(false);
                      setApiKeyStatus('idle');
                      setApiKeyInput('');
                    }}
                    className="py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-medium rounded-lg border border-rose-200 transition-all"
                  >Remove</button>
                )}
              </div>
              <p className="text-[10px] text-slate-400">
                {geminiActive ? 'Gemini active — Google Translate not used.' : 'Without a key, Google Translate (GTX) is used.'}
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3 flex flex-col h-[700px]">
          <div className="flex gap-3 mb-4">
            {(['preview', 'logs', 'export'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg font-medium capitalize transition-colors text-sm ${
                  activeTab === tab ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:text-indigo-600'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">

            {activeTab === 'preview' && (
              <div className="overflow-auto flex-1">
                {groups.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 p-10 text-center">
                    <IconUpload />
                    <p className="mt-4">No content loaded. Upload a SQL file to begin.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Field</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
                          {getLangInfo(sourceLang).flag} {sourceLang.toUpperCase()} (Source)
                        </th>
                        {targetLangs.map(locale => (
                          <th key={locale} className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
                            {getLangInfo(locale).flag} {locale.toUpperCase()}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {groups.map((group, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="text-xs font-mono text-indigo-600 font-bold">{group.source.table_name}</div>
                            <div className="text-xs text-slate-400">{group.source.column_name}</div>
                            <div className="text-[10px] bg-slate-100 text-slate-500 px-1 rounded inline-block">ID: {group.source.foreign_key}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm line-clamp-2" title={group.source.value}>{group.source.value}</div>
                          </td>
                          {targetLangs.map(locale => (
                            <td key={locale} className="px-4 py-3">
                              {group.translations[locale] ? (
                                <div className="text-sm line-clamp-2 italic text-slate-600" title={group.translations[locale].value}>
                                  {group.translations[locale].value}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-300">Pending...</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {activeTab === 'logs' && (
              <div className="p-6 overflow-auto flex-1 font-mono text-sm space-y-2 bg-slate-900 text-slate-300">
                {logs.length === 0 ? (
                  <div className="text-slate-600">Waiting for activity...</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`flex gap-3 ${
                      log.type === 'error' ? 'text-rose-400' :
                      log.type === 'success' ? 'text-emerald-400' :
                      log.type === 'warning' ? 'text-amber-400' : ''
                    }`}>
                      <span className="text-slate-600">[{log.timestamp.toLocaleTimeString()}]</span>
                      <span>{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'export' && (
              <div className="p-8 flex flex-col items-center justify-center text-center h-full">
                <div className="mb-6 bg-indigo-50 p-6 rounded-full">
                  <IconCheck />
                </div>
                <h3 className="text-2xl font-bold mb-2">Ready to Export</h3>
                <p className="text-slate-500 max-w-md mb-2">
                  Generated SQL script will perform DELETE + INSERT for each translated locale.
                </p>
                {targetLangs.length > 0 && (
                  <p className="text-sm text-slate-400 mb-8">
                    Locales: {targetLangs.map(l => `${getLangInfo(l).flag} ${l.toUpperCase()}`).join(' · ')}
                  </p>
                )}
                <div className="flex gap-4">
                  <button
                    onClick={downloadSQL}
                    disabled={status !== ProcessStatus.COMPLETED}
                    className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-50"
                  >
                    Download .SQL File
                  </button>
                  <button
                    onClick={() => {
                      const sql = generateSQL(groups, targetLangs);
                      navigator.clipboard.writeText(sql);
                      addLog('SQL copied to clipboard.', 'success');
                    }}
                    className="px-8 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl shadow-sm transition-all"
                  >
                    Copy to Clipboard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
