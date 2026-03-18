const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const getGeminiKey = (): string => {
    return localStorage.getItem('GEMINI_API_KEY') || process.env.GEMINI_API_KEY || '';
};

export const saveGeminiKey = (key: string): void => {
    if (key.trim()) {
        localStorage.setItem('GEMINI_API_KEY', key.trim());
    } else {
        localStorage.removeItem('GEMINI_API_KEY');
    }
};

export const isGeminiAvailable = (): boolean => {
    return getGeminiKey().trim() !== '';
};

export const translateWithGemini = async (
    text: string,
    targetLocale: string
): Promise<string> => {
    if (!text || text.trim() === '') return text;
    const GEMINI_API_KEY = getGeminiKey();
    if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');

    const languageMap: Record<string, string> = {
        tr: 'Turkish', es: 'Spanish', ru: 'Russian', de: 'German',
        fr: 'French', ar: 'Arabic', zh: 'Chinese', pt: 'Portuguese',
        it: 'Italian', ja: 'Japanese', ko: 'Korean', nl: 'Dutch',
        pl: 'Polish', uk: 'Ukrainian',
    };
    const targetLanguage = languageMap[targetLocale] ?? targetLocale;

    const prompt = `Translate the following text to ${targetLanguage}.

Rules:
- Return ONLY the translated text, nothing else. No explanations, no quotes.
- Preserve all HTML tags exactly as they are (e.g. <b>, <br>, <span class="...">).
- Preserve all placeholder tokens like XTAG0X, XTAG1X, XTAG2X etc. — keep them exactly as-is, do not translate or modify them.
- Preserve all placeholders like :attribute, :value, %s, %d, {{ variable }}.
- Preserve all URLs as-is.
- Do not add markdown formatting.

Text to translate:
${text}`;

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 2048,
            },
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error ${response.status}: ${err?.error?.message ?? 'Unknown'}`);
    }

    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return result.trim();
};

const GEMINI_BULK_SIZE = 40; // max items per single bulk request

/**
 * Sends multiple texts in a single Gemini API call.
 * Returns a translated array in the same order.
 */
const translateBulkWithGemini = async (
    texts: string[],
    targetLocale: string
): Promise<string[]> => {
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await translateWithGemini(texts[0], targetLocale)];

    const GEMINI_API_KEY = getGeminiKey();
    if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');

    const languageMap: Record<string, string> = {
        tr: 'Turkish', es: 'Spanish', ru: 'Russian', de: 'German',
        fr: 'French', ar: 'Arabic', zh: 'Chinese', pt: 'Portuguese',
        it: 'Italian', ja: 'Japanese', ko: 'Korean', nl: 'Dutch',
        pl: 'Polish', uk: 'Ukrainian',
    };
    const targetLanguage = languageMap[targetLocale] ?? targetLocale;

    const numbered = texts.map((t, i) => `[${i}] ${t}`).join('\n---\n');

    const prompt = `Translate each numbered item below to ${targetLanguage}.

Rules:
- Return ONLY a valid JSON array of strings: ["translation0", "translation1", ...]
- Keep the exact same order and count as the input.
- Preserve HTML tags, XTAG0X-style tokens, URLs, and placeholders (:attr, %s, {{ var }}) exactly as-is.
- No explanations, no markdown fences, just the JSON array.

Items:
${numbered}`;

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error ${response.status}: ${err?.error?.message ?? 'Unknown'}`);
    }

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    try {
        // Strip potential markdown code fences
        const cleaned = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
        const parsed: string[] = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length === texts.length) return parsed;
    } catch {
        // JSON parse failed — fall back to individual requests
    }

    // Fallback: translate one by one
    return Promise.all(texts.map(t => translateWithGemini(t, targetLocale)));
};

export const translateBatchWithGemini = async (
    texts: string[],
    targetLocale: string
): Promise<string[]> => {
    const results: string[] = new Array(texts.length);

    for (let i = 0; i < texts.length; i += GEMINI_BULK_SIZE) {
        const chunk = texts.slice(i, i + GEMINI_BULK_SIZE);
        const chunkResults = await translateBulkWithGemini(chunk, targetLocale);
        chunkResults.forEach((r, j) => { results[i + j] = r; });
    }

    return results;
};

export const testGeminiKey = async (key: string): Promise<{ ok: boolean; error?: string }> => {
    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${key.trim()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'Say "ok"' }] }],
                generationConfig: { maxOutputTokens: 5 },
            }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return { ok: false, error: err?.error?.message ?? `HTTP ${response.status}` };
        }
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
