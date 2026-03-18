
const SLEEP_MS = 500;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const protectHtml = (text: string): { maskedText: string; tags: string[] } => {
    const tags: string[] = [];
    // Matches HTML tags (e.g. <div class="foo">, </span>, <img />)
    // Matches URLs (http/https) to prevent them from being translated
    // Also protects specific Laravel Voyager/Blade syntax if likely to occur
    const tagRegex = /<[^>]+>|https?:\/\/[^\s<"']+|%[s|d]|\{\{[^}]+\}\}/g;

    const maskedText = text.replace(tagRegex, (match) => {
        tags.push(match);
        // Using a very simple, non-translatable token format
        // Emoji helps because translation engines usually ignore them or keep them intact
        return `👉${tags.length - 1}👈`;
    });

    return { maskedText, tags };
};

const restoreHtml = (maskedText: string, tags: string[]): string => {
    // Matches the simple emoji token format
    return maskedText.replace(/👉\s*(\d+)\s*👈/g, (match, index) => {
        const i = parseInt(index, 10);
        return tags[i] !== undefined ? tags[i] : match;
    });
};

import { applySectoralTerminology, preProcessEnglishSource } from './terminologyService';
import { isGeminiAvailable, translateBatchWithGemini } from './geminiService';

export const translateWithGoogleGTX = async (
    text: string,
    targetLocale: 'es' | 'ru'
): Promise<string> => {
    if (!text || text.trim() === '') return text;

    try {
        // PRE-PROCESS: Fix source errors (e.g., Desct -> Disc)
        const cleanSource = preProcessEnglishSource(text);

        // Protect HTML tags and placeholders
        const { maskedText, tags } = protectHtml(cleanSource);

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

        // Restore tags into the translated text
        const restoredText = restoreHtml(translatedText, tags);

        // APPLY SECTORAL TERMINOLOGY & BRAND PROTECTION
        return applySectoralTerminology(restoredText, targetLocale);

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
    targetLocale: 'es' | 'ru'
): Promise<string[]> => {
    if (isGeminiAvailable()) {
        return translateBatchWithGemini(texts, targetLocale);
    }
    return Promise.all(texts.map(text => translateWithGoogleGTX(text, targetLocale)));
};
