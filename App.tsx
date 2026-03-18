
import React, { useState, useCallback, useRef } from 'react';
import {
  VoyagerTranslation,
  ProcessStatus,
  ProcessingLog,
  TranslationGroup
} from './types';
import {
  parseVoyagerSQL,
  groupTranslations,
  generateSQL
} from './services/sqlUtils';
import { translateBatch } from './services/lingvaService';
import { isGeminiAvailable, saveGeminiKey, testGeminiKey } from './services/geminiService';
import { translateComplexHtml } from './services/htmlTranslator';
import { slugify } from './services/textUtils';
// Icons using SVG for simplicity
const IconUpload = () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
const IconCheck = () => <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;
const IconLoading = () => <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default function App() {
  const [status, setStatus] = useState<ProcessStatus>(ProcessStatus.IDLE);
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [groups, setGroups] = useState<TranslationGroup[]>([]);
  const [activeTab, setActiveTab] = useState<'preview' | 'logs' | 'export'>('preview');
  const [geminiActive, setGeminiActive] = useState<boolean>(isGeminiAvailable());
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [apiKeySaved, setApiKeySaved] = useState<boolean>(false);
  const [apiKeyTesting, setApiKeyTesting] = useState<boolean>(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [apiKeyError, setApiKeyError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        const parsed = parseVoyagerSQL(content);
        addLog(`Successfully parsed ${parsed.length} rows from SQL.`);

        const grouped = groupTranslations(parsed);
        addLog(`Identified ${grouped.length} translation groups (EN sources).`);

        setGroups(grouped);
        setStatus(ProcessStatus.IDLE);
      } catch (err) {
        addLog(`Error parsing SQL: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        setStatus(ProcessStatus.ERROR);
      }
    };
    reader.readAsText(file);
  };

  const startTranslation = async () => {
    if (groups.length === 0) return;
    setStatus(ProcessStatus.TRANSLATING);
    addLog(`Starting batch translation with ${isGeminiAvailable() ? 'Gemini AI' : 'Google Translate (GTX)'}...`);
    addLog("NOTE: This will overwrite ALL existing Spanish/Russian translations with new versions from English.");

    const updatedGroups = [...groups];
    const batchSize = 500;

    try {
      let i = 0;
      while (i < updatedGroups.length) {
        const batch = updatedGroups.slice(i, i + batchSize);
        const enTexts = batch.map(g => g.en.value);
        const currentBatchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(updatedGroups.length / batchSize);

        addLog(`Processing batch ${currentBatchNum}/${totalBatches} (${batch.length} items)...`);

        // Check if this batch is for complex HTML columns
        // Users reported issues with 'features' and 'teknik_tablo_html', so we treat them specially
        const isComplexHtmlBatch = batch.some(g =>
          g.en.column_name === 'teknik_tablo_html' ||
          g.en.column_name === 'features'
        );

        try {
          let esTranslations: string[] = [];
          let ruTranslations: string[] = [];

          if (isComplexHtmlBatch) {
            // For complex HTML, we process item by item using the DOM-aware translator
            // This is slower but guarantees structure isn't broken
            addLog(`Batch ${currentBatchNum}: Detected HTML content. Using safe mode...`);

            for (const text of enTexts) {
              // Fix for the newline/backslash hell described by user
              // Clean up excessive backslashes before processing (e.g. \\\\n -> \n)
              const cleanText = text.replace(/\\\\+n/g, '\n').replace(/\\n/g, '\n');

              esTranslations.push(await translateComplexHtml(cleanText, 'es'));
              ruTranslations.push(await translateComplexHtml(cleanText, 'ru'));
            }
          } else {
            // Standard fast batch translation for simple text
            esTranslations = await translateBatch(enTexts, 'es');
            ruTranslations = await translateBatch(enTexts, 'ru');
          }

          batch.forEach((group, index) => {
            let esVal = esTranslations[index];
            let ruVal = ruTranslations[index];

            // Fix for Slugs: If the column is 'slug', we must ensure it's URL friendly.
            if (group.en.column_name === 'slug') {
              esVal = slugify(esVal);
              ruVal = slugify(ruVal);
            }

            group.es = { ...group.en, locale: 'es', value: esVal };
            group.ru = { ...group.en, locale: 'ru', value: ruVal };
          });

          setGroups([...updatedGroups]);

          // Only increment if successful
          i += batchSize;

          // Success delay - reduced for speed
          await sleep(50);

        } catch (batchError: any) {
          const isRateLimit = batchError?.message?.includes('429') || batchError?.message?.includes('Rate Limit');
          addLog(`Error in batch ${currentBatchNum}: ${batchError.message}`, "error");

          if (isRateLimit) {
            addLog("Rate limit hit. Waiting 20 seconds before retrying this batch...", "warning");
            await sleep(20000);
            // Loop continues without incrementing 'i', so it retries the same batch
          } else {
            // If it's another error (not rate limit), maybe we should skip to avoid infinite loop?
            // For now, let's treat all errors as retry-able but with shorter wait, 
            // OR force skip if it persists. But user wants 200, so let's just retry.
            addLog("Retrying in 5 seconds...", "info");
            await sleep(5000);
          }
        }
      }

      addLog("Translation process finished!", "success");
      setStatus(ProcessStatus.COMPLETED);
      setActiveTab('export');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      addLog(`Unexpected failure: ${errMsg}`, 'error');
      setStatus(ProcessStatus.ERROR);
    }
  };

  const downloadSQL = () => {
    const sql = generateSQL(groups);
    const blob = new Blob([sql], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voyager_translations_update_${new Date().toISOString().split('T')[0]}.sql`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("SQL File downloaded.", "success");
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight mb-2">
          Voyager <span className="text-indigo-600">Translator Pro</span>
        </h1>
        <p className="text-slate-500 max-w-2xl mx-auto">
          Automate your Laravel Voyager multi-language content. Convert English sources to Spanish and Russian
          while maintaining HTML safety and technical placeholders.
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
        {/* Sidebar / Controls */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><IconUpload /></span>
              Control Center
            </h2>

            <div className="space-y-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={status === ProcessStatus.TRANSLATING}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
              >
                Upload SQL Dump
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                accept=".sql"
              />

              <button
                onClick={startTranslation}
                disabled={groups.length === 0 || status === ProcessStatus.TRANSLATING || status === ProcessStatus.COMPLETED}
                className="w-full py-3 px-4 bg-white hover:bg-slate-50 border-2 border-indigo-600 text-indigo-600 disabled:opacity-50 font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
              >
                {status === ProcessStatus.TRANSLATING ? <IconLoading /> : null}
                {status === ProcessStatus.TRANSLATING ? 'Translating...' : 'Start AI Translation'}
              </button>

              {status === ProcessStatus.COMPLETED && (
                <button
                  onClick={downloadSQL}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-all shadow-md"
                >
                  Download Updated SQL
                </button>
              )}
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Stats</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-indigo-600">{groups.length}</div>
                  <div className="text-xs text-slate-500">Source Items</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg text-center">
                  <div className="text-2xl font-bold text-emerald-600">
                    {groups.filter(g => g.es && g.ru).length}
                  </div>
                  <div className="text-xs text-slate-500">Completed</div>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Gemini API Key</h3>
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
                  <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                    <span>✓</span> API key geçerli, Gemini aktif.
                  </p>
                )}
                {apiKeyStatus === 'error' && (
                  <p className="text-xs text-rose-600 flex items-center gap-1">
                    <span>✗</span> {apiKeyError}
                  </p>
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
                    className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-1"
                  >
                    {apiKeyTesting ? (
                      <><IconLoading /> Test ediliyor...</>
                    ) : apiKeySaved ? '✓ Kaydedildi' : 'Test Et & Kaydet'}
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
                      className="py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-600 text-sm font-medium rounded-lg border border-rose-200 transition-all"
                    >
                      Sil
                    </button>
                  )}
                </div>

                <p className="text-[10px] text-slate-400">
                  {geminiActive ? 'Gemini aktif — GTX kullanılmıyor.' : 'Key girilmezse Google Translate (GTX) kullanılır.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-3 flex flex-col h-[700px]">
          <div className="flex gap-4 mb-4">
            {(['preview', 'logs', 'export'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg font-medium capitalize transition-colors ${activeTab === tab
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-slate-500 hover:text-indigo-600'
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
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Field Info</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">English (EN)</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Spanish (ES)</th>
                        <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Russian (RU)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {groups.map((group, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="text-xs font-mono text-indigo-600 font-bold">{group.en.table_name}</div>
                            <div className="text-xs text-slate-400">{group.en.column_name}</div>
                            <div className="text-[10px] bg-slate-100 text-slate-500 px-1 rounded inline-block">ID: {group.en.foreign_key}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm line-clamp-2" title={group.en.value}>{group.en.value}</div>
                          </td>
                          <td className="px-6 py-4">
                            {group.es ? (
                              <div className="text-sm line-clamp-2 italic text-slate-600" title={group.es.value}>{group.es.value}</div>
                            ) : (
                              <span className="text-xs text-slate-300">Pending...</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {group.ru ? (
                              <div className="text-sm line-clamp-2 italic text-slate-600" title={group.ru.value}>{group.ru.value}</div>
                            ) : (
                              <span className="text-xs text-slate-300">Pending...</span>
                            )}
                          </td>
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
                    <div key={i} className={`flex gap-3 ${log.type === 'error' ? 'text-rose-400' :
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
                <p className="text-slate-500 max-w-md mb-8">
                  Generated SQL script will perform `INSERT` for new translations and `UPDATE` for existing ones
                  without affecting your current data structure.
                </p>
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
                      const sql = generateSQL(groups);
                      navigator.clipboard.writeText(sql);
                      addLog("SQL copied to clipboard.", "success");
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
