
const SLEEP_MS = 500;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const protectHtml = (text: string): { maskedText: string; tags: string[] } => {
    const tags: string[] = [];
    const tagRegex = /<[^>]+>|https?:\/\/[^\s<"']+|%[sd]|\{\{[^}]+\}\}/g;

    const maskedText = text.replace(tagRegex, (match) => {
        tags.push(match);
        // Token format: XTAGNNX — Latin-only, no spaces, safe for RTL languages (Arabic, Hebrew etc.)
        // Won't be translated or reordered by any translation engine
        return `XTAG${tags.length - 1}X`;
    });

    return { maskedText, tags };
};

const restoreHtml = (maskedText: string, tags: string[]): string => {
    // Handles possible spaces or Arabic numerals injected around the token by translation engines
    return maskedText.replace(/XTAG\s*([0-9٠-٩]+)\s*X/g, (match, index) => {
        // Normalize Arabic-Indic digits to Western digits just in case
        const normalized = index.replace(/[٠-٩]/g, (d: string) => String(d.charCodeAt(0) - 0x0660));
        const i = parseInt(normalized, 10);
        return tags[i] !== undefined ? tags[i] : match;
    });
};

import { isGeminiAvailable, translateBatchWithGemini } from './geminiService';

export const translateWithGoogleGTX = async (
    text: string,
    targetLocale: string
): Promise<string> => {
    if (!text || text.trim() === '') return text;

    try {
        const { maskedText, tags } = protectHtml(text);

        const url = `/translate-api/translate_a/single?client=gtx&sl=auto&tl=${targetLocale}&dt=t&q=${encodeURIComponent(maskedText)}`;

        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('429 Rate Limit');
            }
            throw new Error(`GTX API status: ${response.status}`);
        }

        const data = await response.json();
        let translatedText = '';

        if (data && data[0]) {
            translatedText = data[0].map((sentence: any) => sentence[0]).join('');
            translatedText = translatedText.replace(/\\n/g, '\n').replace(/\n\s*\n/g, '\n');
        } else {
            translatedText = maskedText;
        }

        return restoreHtml(translatedText, tags);

    } catch (error: any) {
        if (error.message && error.message.includes('429')) {
            throw error;
        }
        console.error("Translation Error:", error);
        return text;
    }
};

export const translateBatch = async (
    texts: string[],
    targetLocale: string
): Promise<string[]> => {
    if (isGeminiAvailable()) {
        return translateBatchWithGemini(texts, targetLocale);
    }
    return Promise.all(texts.map(text => translateWithGoogleGTX(text, targetLocale)));
};
