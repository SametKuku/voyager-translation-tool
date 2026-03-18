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
    targetLocale: 'es' | 'ru'
): Promise<string> => {
    if (!text || text.trim() === '') return text;
    const GEMINI_API_KEY = getGeminiKey();
    if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');

    const languageMap: Record<string, string> = {
        es: 'Spanish',
        ru: 'Russian',
    };
    const targetLanguage = languageMap[targetLocale];

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
    targetLocale: 'es' | 'ru'
): Promise<string[]> => {
    return Promise.all(texts.map(text => translateWithGemini(text, targetLocale)));
};
