
interface TerminologyRule {
    original: string | RegExp;
    replacement: string;
    caseSensitive?: boolean;
}

/**
 * Spanish (ES) Industrial & Agricultural Filtration Terminology
 * Focus: Moving away from general terms (like Pantalla) to technical terms (Malla).
 */
const spanishRules: TerminologyRule[] = [
    // Core Filters
    { original: /\bPantalla\b/g, replacement: 'Malla' },
    { original: /\bpantalla\b/g, replacement: 'malla' },
    { original: /Filtro de pantalla/gi, replacement: 'Filtro de malla' },

    // Disc Filter Fixes (User mentioned Desct -> Discos)
    { original: /Desct/g, replacement: 'Discos' },
    { original: /desct/g, replacement: 'discos' },
    { original: /\bDisc filter\b/gi, replacement: 'Filtro de discos' },
    { original: /\bDisco filter\b/gi, replacement: 'Filtro de discos' },

    // Technical components
    { original: /Backwash/gi, replacement: 'Contralavado' },
    { original: /Self cleaning/gi, replacement: 'Autolimpiante' },
    { original: /Suction scanner/gi, replacement: 'Escáner de succión' },
    { original: /Hydrocyclone/gi, replacement: 'Hidrociclón' },
    { original: /Sand filter/gi, replacement: 'Filtro de arena' },
    { original: /Gravel filter/gi, replacement: 'Filtro de grava' },

    // General Irrigation
    { original: /Irrigation system/gi, replacement: 'Sistema de riego' },
    { original: /Agricultural/gi, replacement: 'Agrícola' },
    { original: /Drip irrigation/gi, replacement: 'Riego por goteo' },
    { original: /Filtration system/gi, replacement: 'Sistema de filtración' },
    { original: /Manual filter/gi, replacement: 'Filtro manual' },
];

/**
 * Russian (RU) Industrial & Agricultural Filtration Terminology
 * Focus: Using standard GOST-like technical terms for irrigation.
 */
const russianRules: TerminologyRule[] = [
    // Core Filters
    { original: /Экранный фильтр/gi, replacement: 'Сетчатый фильтр' },
    { original: /Экран фильтр/gi, replacement: 'Сетчатый фильтр' },
    { original: /Фильтр экрана/gi, replacement: 'Сетчатый фильтр' },
    { original: /Сетчатый экран/gi, replacement: 'Сетчатый элемент' },

    // Disc Filters
    { original: /Диск фильтр/gi, replacement: 'Дисковый фильтр' },
    { original: /Дисковой фильтр/gi, replacement: 'Дисковый фильтр' },

    // Technical components
    { original: /Обратная промывка/gi, replacement: 'Автоматическая обратная промывка' }, // Standard for auto filters
    { original: /Самоочищающийся/gi, replacement: 'Самоочищающийся' },
    { original: /Всасывающий сканер/gi, replacement: 'Сканирующее всасывающее устройство' },
    { original: /Гидроциклон/gi, replacement: 'Гидроциклон' },
    { original: /Песчаный фильтр/gi, replacement: 'Песчано-гравийный фильтр' },

    // General Irrigation
    { original: /Система орошения/gi, replacement: 'Система полива' }, // 'Полив' is more common in agriculture
    { original: /Сельскохозяйственный/gi, replacement: 'Сельскохозяйственный' },
    { original: /Капельное орошение/gi, replacement: 'Капельный полив' },
    { original: /Система фильтрации/gi, replacement: 'Установка фильтрации' },
    { original: /Ручной фильтр/gi, replacement: 'Фильтр с ручной промывкой' },
];

/**
 * Brand protection and specific nomenclature.
 * These should always remain in Latin script or be strictly enforced.
 */
const brandRules: string[] = [
    'Aytok',
    'Aytok Filter',
    'Azud',
    'STF Filters',
    'STF',
    'Lama',
    'Jimten',
    'Amiad',
    'Netafim',
    'Arkal',
    'Filtomat'
];

/**
 * PRE-PROCESSING: Fix common source errors in English before translation.
 * If the user's SQL has "Desct", the AI might get confused. We fix it to "Disc" first.
 */
export const preProcessEnglishSource = (text: string): string => {
    if (!text) return text;
    let processed = text;

    // Fix common typos/shorthands in the source SQL provided by the user
    processed = processed.replace(/Desct/g, 'Disc');
    processed = processed.replace(/desct/g, 'disc');

    return processed;
};

/**
 * POST-PROCESSING: Apply industry-specific terminology and protect brand names.
 */
export const applySectoralTerminology = (
    text: string,
    locale: 'es' | 'ru'
): string => {
    if (!text) return text;

    let processedText = text;

    // 1. Apply locale specific rules
    const rules = locale === 'es' ? spanishRules : russianRules;
    rules.forEach(rule => {
        if (rule.original instanceof RegExp) {
            processedText = processedText.replace(rule.original, rule.replacement);
        } else {
            const flags = rule.caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(rule.original, flags);
            processedText = processedText.replace(regex, rule.replacement);
        }
    });

    // 2. Brand Protection (Case Insensitive find, Case Sensitive replace)
    brandRules.forEach(brand => {
        const regex = new RegExp(`\\b${brand}\\b`, 'gi');
        processedText = processedText.replace(regex, brand);
    });

    return processedText;
};
