/**
 * The languages the product tour is written in. Kept apart from its content so the shell (which links to the tour)
 * doesn't load the content. Until another language has its own file in `content/`, only people using Traditional
 * Chinese are offered the tour.
 */
export const TOUR_LOCALES = ['zh-TW'] as const;
export const tourAvailable = (locale: string) => (TOUR_LOCALES as readonly string[]).includes(locale);
