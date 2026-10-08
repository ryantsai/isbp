import type { GuideLocale } from './meta';

/** One guide in one language, ready to publish as a knowledge article. */
export interface GuideArticle {
  slug: string;
  /** File name in docs/guide/<locale>/. */
  file: string;
  locale: GuideLocale;
  /** Position in the table of contents. */
  order: number;
  title: string;
  /** The guide's first paragraph, as plain text. */
  summary: string;
  /** Markdown, with links between guides and screenshot paths rewritten for the web app. */
  body: string;
  /** Changes whenever the article's content does. */
  hash: string;
}

export * from './meta';
export { GUIDE_VERSION, guideArticles } from './generated';
