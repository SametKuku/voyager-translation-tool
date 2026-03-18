

const SLEEP_MS = 1000;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const translateWithMyMemory = async (
    text: string,
    targetLocale: 'es' | 'ru',
    attempt = 1
): Promise<string> => {
    if (!text || text.trim() === '') return text;

    const langPair = `en|${targetLocale}`;

    // Random email generator to use a different "user" for each request
    // This helps bypass the daily limit associated with a single static email.
    const randomId = Math.floor(Math.random() * 1000000);
    const email = `voyager_user_${randomId}@gmail.com`;

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}&de=${email}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.responseStatus === 200) {
            return data.responseData.translatedText;
        } else if (data.responseStatus === 429 || data.responseStatus === "429") {
            if (attempt <= MAX_RETRIES) {
                const backoff = SLEEP_MS * Math.pow(2, attempt);
                console.warn(`MyMemory Rate Limit (429). Retrying in ${backoff}ms...`);
                await sleep(backoff);
                return translateWithMyMemory(text, targetLocale, attempt + 1);
            }
            throw new Error(`MyMemory Rate Limit: ${data.responseDetails}`);
        } else {
            throw new Error(`MyMemory API Error: ${data.responseDetails}`);
        }
    } catch (error) {
        if (attempt <= MAX_RETRIES && !(error instanceof Error && error.message.includes('429'))) {
            await sleep(SLEEP_MS * attempt);
            return translateWithMyMemory(text, targetLocale, attempt + 1);
        }
        throw error;
    }
};

export const translateBatch = async (
    texts: string[],
    targetLocale: 'es' | 'ru'
): Promise<string[]> => {
    const results: string[] = [];

    // Sequential processing instead of parallel to be safer with rate limits
    for (const text of texts) {
        const translated = await translateWithMyMemory(text, targetLocale);
        results.push(translated);
        // Add a small gap between individual requests
        await sleep(500);
    }

    return results;
};
