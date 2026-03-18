
const cyrillicToLatinMap: Record<string, string> = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
    'я': 'ya',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh',
    'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O',
    'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'H', 'Ц': 'Ts',
    'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu',
    'Я': 'Ya',
};

const turkishToLatinMap: Record<string, string> = {
    'ğ': 'g', 'Ğ': 'G',
    'ü': 'u', 'Ü': 'U',
    'ş': 's', 'Ş': 'S',
    'ı': 'i', 'İ': 'I',
    'ö': 'o', 'Ö': 'O',
    'ç': 'c', 'Ç': 'C',
};

// Arabic/Persian character ranges — transliterate to closest Latin approximation
const arabicToLatinMap: Record<string, string> = {
    'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th',
    'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z',
    'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a',
    'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
    'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'h', 'ء': '', 'ئ': 'y',
    'ؤ': 'w', 'ـ': '', '\u064B': '', '\u064C': '', '\u064D': '', '\u064E': '',
    '\u064F': '', '\u0650': '', '\u0651': '', '\u0652': '',
};

export const transliterate = (text: string): string => {
    return text.split('').map(char =>
        cyrillicToLatinMap[char] ??
        turkishToLatinMap[char] ??
        arabicToLatinMap[char] ??
        char
    ).join('');
};

export const slugify = (text: string, fallback?: string): string => {
    if (!text) return fallback ? slugify(fallback) : '';

    let processed = text;
    try { processed = decodeURIComponent(text); } catch { /* keep original */ }

    // Transliterate all known scripts (Cyrillic, Turkish, Arabic)
    processed = transliterate(processed);

    // Normalize Unicode and remove remaining diacritics (Spanish, French, etc.)
    processed = processed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    processed = processed.toLowerCase().trim();

    const slug = processed
        .replace(/%20/g, '-')
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');

    // If slug is empty after processing (e.g. CJK chars with no transliteration),
    // fall back to the provided fallback or a hash of the original text
    if (!slug) {
        if (fallback) return slugify(fallback);
        // Last resort: generate a numeric hash from the text
        let hash = 0;
        for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash) + text.charCodeAt(i);
        return 'item-' + Math.abs(hash).toString(36);
    }

    return slug;
};
