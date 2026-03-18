
import { translateBatch } from './lingvaService';

/**
 * Parses HTML, extracts text nodes, translates them in batch, 
 * and reconstructs the HTML with preserved structure.
 * This is much safer for complex tables than regex replacement.
 */
export const translateComplexHtml = async (
    htmlContent: string,
    targetLocale: 'es' | 'ru'
): Promise<string> => {
    if (!htmlContent) return htmlContent;

    // PRE-CLEANING: 
    // Fix escaped quotes that might confuse DOMParser. 
    // Turns style=\"width:100%\" into style="width:100%"
    // Turns style=\&quot;width:100%\&quot; into style="width:100%"
    let cleanHtml = htmlContent
        .replace(/\\"/g, '"')
        .replace(/\\&quot;/g, '"')
        .replace(/\\'/g, "'");

    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanHtml, 'text/html');
    const walker = document.createTreeWalker(
        doc.body,
        NodeFilter.SHOW_TEXT,
        null
    );

    const textNodes: Node[] = [];
    const textsToTranslate: string[] = [];

    let currentNode: Node | null = walker.nextNode();
    while (currentNode) {
        const text = currentNode.textContent?.trim();
        // Filter out empty strings, pure numbers, or tiny symbols to save API calls
        if (text && text.length > 1 && isNaN(Number(text))) {
            textNodes.push(currentNode);
            textsToTranslate.push(text);
        }
        currentNode = walker.nextNode();
    }

    if (textsToTranslate.length === 0) {
        return htmlContent;
    }

    // Translate all text nodes in chunks to avoid URL length limits
    const translatedTexts: string[] = [];
    const chunkSize = 225; // Safe chunk size for texts

    for (let i = 0; i < textsToTranslate.length; i += chunkSize) {
        const chunk = textsToTranslate.slice(i, i + chunkSize);
        try {
            const chunkResults = await translateBatch(chunk, targetLocale);
            translatedTexts.push(...chunkResults);
        } catch (err) {
            console.error("HTML Fixer Translation Error:", err);
            // Fallback to original
            translatedTexts.push(...chunk);
        }
    }

    // Replace text content
    textNodes.forEach((node, index) => {
        if (translatedTexts[index]) {
            node.textContent = translatedTexts[index];
        }
    });

    let finalHtml = doc.body.innerHTML;
    // Safety net: Remove any lingering V_TAG artifacts that might have slipped through
    finalHtml = finalHtml.replace(/__V_TAG_\d+__/g, '');
    finalHtml = finalHtml.replace(/__\s*V_\s*TAG_\d+__/g, '');

    // FIX: Decode HTML entities that might have been double-encoded or returned by DOMParser
    // <div title="&lt;..."> should be <div title="<..."> in the final raw SQL usually, 
    // but more importantly, standard tags like &lt;/tr&gt; must become </tr>
    finalHtml = finalHtml
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/\\"/g, '"'); // Final sweep for backslashed quotes
    // We might want to keep &nbsp; as space or &nbsp; depending on usage, 
    // but typically standard tags need to be real < >

    return finalHtml;
};
