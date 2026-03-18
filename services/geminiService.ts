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
- Return ONLY the translated text, nothing else.
- Preserve all HTML tags exactly as they are (e.g. <b>, <br>, <span class="...">).
- Preserve all placeholders like :attribute, :value, %s, %d, {{ variable }}.
- Preserve all URLs as-is.
- Do not add any explanation or quotes around the result.

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

export const translateBatchWithGemini = async (
    texts: string[],
    targetLocale: string
): Promise<string[]> => {
    return Promise.all(texts.map(text => translateWithGemini(text, targetLocale)));
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
