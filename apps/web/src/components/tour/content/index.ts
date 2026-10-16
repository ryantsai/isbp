import type { TourContent, TourShot } from './types';
import { zhTW } from './zh-TW';

export type * from './types';

export { TOUR_LOCALES, tourAvailable } from '../locales';

const CONTENT: Record<string, TourContent> = { 'zh-TW': zhTW };

export function getTourContent(locale: string): TourContent {
  return CONTENT[locale] ?? zhTW;
}

/** Where a screenshot is served from (`apps/web/public/help/<locale>/tour/<name>.jpg`, `pnpm docs:screenshots tour`). */
export const shotSrc = (shot: TourShot, contentLocale: string) =>
  `/help/${shot.locale ?? contentLocale}/tour/${shot.name}.jpg`;
