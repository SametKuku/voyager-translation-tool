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

const GEMINI_CONCURRENCY = 5; // max parallel requests to avoid rate limiting

export const translateBatchWithGemini = async (
    texts: string[],
    targetLocale: string
): Promise<string[]> => {
    const results: string[] = new Array(texts.length);

    for (let i = 0; i < texts.length; i += GEMINI_CONCURRENCY) {
        const chunk = texts.slice(i, i + GEMINI_CONCURRENCY);
        const chunkResults = await Promise.all(
            chunk.map(text => translateWithGemini(text, targetLocale))
        );
        chunkResults.forEach((r, j) => { results[i + j] = r; });
        // Small delay between chunks to respect rate limits
        if (i + GEMINI_CONCURRENCY < texts.length) {
            await new Promise(r => setTimeout(r, 300));
        }
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
