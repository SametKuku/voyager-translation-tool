
const cyrillicToLatinMap: Record<string, string> = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
    'я': 'ya',
    // Although we usually lowercase before mapping, keeping uppercase for completeness if generic use
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh',
    'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O',
    'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'H', 'Ц': 'Ts',
    'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu',
    'Я': 'Ya'
};

export const transliterate = (text: string): string => {
    return text.split('').map(char => cyrillicToLatinMap[char] || char).join('');
};

export const slugify = (text: string): string => {
    if (!text) return '';

    // 1. Decode URI components
    let processed = decodeURIComponent(text);

    // 2. Transliterate Cyrillic to Latin
    processed = transliterate(processed);

    // 3. Normalize and remove accents/diacritics (for Spanish etc.)
    // e.g. "adiós" -> "adios"
    processed = processed.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 4. Lowercase and trim
    processed = processed.toLowerCase().trim();

    // 5. Custom cleanups
    return processed
        .replace(/%20/g, '-')     // Fix explicit %20
        .replace(/\s+/g, '-')     // Spaces to dashes
        .replace(/[^\w\-]+/g, '') // Remove non-word chars (keeping only Latin letters, numbers, underscore, dash).
        .replace(/\-\-+/g, '-')   // Merge multiple dashes
        .replace(/^-+/, '')       // Trim leading dashes
        .replace(/-+$/, '');      // Trim trailing dashes
};
