/**
 * The product tour's content, as plain data (no React): one file per language, so a translation is a new file and
 * the components never change. `**text**` marks a label exactly as the screen shows it (rendered semibold).
 */

/** Lucide icon key (kebab-case); `icons.ts` maps each to its component. */
export type TourIcon =
  | 'house'
  | 'life-buoy'
  | 'rocket'
  | 'package'
  | 'shield-check'
  | 'folder-kanban'
  | 'notebook-text'
  | 'database'
  | 'plug-zap'
  | 'sparkles'
  | 'workflow'
  | 'settings'
  | 'monitor'
  | 'server'
  | 'layers'
  | 'key-round'
  | 'scroll-text'
  | 'lock'
  | 'users'
  | 'git-branch'
  | 'bell'
  | 'link'
  | 'paperclip'
  | 'list-checks'
  | 'brain-circuit'
  | 'globe'
  | 'gauge'
  | 'puzzle'
  | 'cable'
  | 'file-check'
  | 'cpu'
  | 'book-open';

/** A real screenshot from the demo (`apps/web/public/help/<locale>/<name>.jpg`) and its pixel size. */
export interface TourShot {
  /** File name without folder or extension: `service-desk-ticket`. */
  name: string;
  alt: string;
  /** Pixel size of the file (all full-page captures are 1280 × 800). */
  w: number;
  h: number;
  /** The language the screenshot was taken in, when it is not the content's own. */
  locale?: 'en' | 'zh-TW' | 'ja-JP';
}

/** A call-out on a screenshot: a point in the screenshot's own pixels and what is there. */
export interface TourMark {
  x: number;
  y: number;
  label: string;
  /** Which side of the point the label sits (default: right, or left when the point is in the right half). */
  side?: 'left' | 'right' | 'top' | 'bottom';
}

export interface TourStep {
  id: string;
  title: string;
  /** Where in the product this is (shown under the screenshot), e.g. `服務台 → 工單`. */
  where: string;
  body: string;
  points: string[];
  shot: TourShot;
  marks?: TourMark[];
}

export interface TourArea {
  id: string;
  icon: TourIcon;
  /** Short name for the chapter menu and the map. */
  nav: string;
  title: string;
  pitch: string;
  where: string;
  who: string[];
  /** The guide chapter that goes deeper (a slug of `@isbp/guide/meta`). */
  guide: { slug: string; label: string };
  steps: TourStep[];
}

export interface TourJourneyStep {
  title: string;
  body: string;
  who: string;
  shot: TourShot;
}

export interface TourJourney {
  id: string;
  icon: TourIcon;
  nav: string;
  title: string;
  intro: string;
  steps: TourJourneyStep[];
  /** Where the guide tells the whole story. */
  guide: { slug: string; anchor?: string; label: string };
}

export interface TourStat {
  /** Which number: the tour test compares each with the generated extension-point reference. */
  key: 'modules' | 'permissions' | 'roles' | 'events' | 'aiTools' | 'notifications' | 'areas' | 'languages';
  value: number;
  label: string;
  hint: string;
}

export interface TourLayer {
  id: string;
  icon: TourIcon;
  name: string;
  tech: string;
  items: { label: string; note: string }[];
}

export interface TourRequestStep {
  /** Lanes (see `lanes`) the message travels between. */
  from: string;
  to: string;
  title: string;
  body: string;
}

export interface TourModuleInfo {
  id: string;
  name: string;
  note: string;
  dependsOn?: string[];
  /** Group in the module map. */
  group: string;
}

export interface TourGate {
  icon: TourIcon;
  title: string;
  body: string;
}

export interface TourRole {
  who: string;
  guide: { slug: string; label: string };
}

export interface TourContent {
  locale: string;
  /** The page's `<title>` and description. */
  meta: { title: string; description: string };
  chrome: {
    brand: string;
    back: string;
    menuAreas: string;
    progress: string;
    skip: string;
    openLarge: string;
    closeLarge: string;
    where: string;
    who: string;
    guideCta: string;
    step: string;
    of: string;
    play: string;
    pause: string;
    previous: string;
    next: string;
    replay: string;
    demoNote: string;
  };
  hero: {
    kicker: string;
    title: string;
    lead: string;
    start: string;
    openProduct: string;
    openGuide: string;
    note: string;
    chips: string[];
    /** Three real screens, layered in the hero. */
    shots: TourShot[];
  };
  sections: { id: string; nav: string }[];
  overview: {
    title: string;
    lead: string;
    mapTitle: string;
    mapHint: string;
    coreLabel: string;
    coreNote: string;
    stats: TourStat[];
    shared: { title: string; lead: string; items: { icon: TourIcon; title: string; body: string }[] };
    open: string;
  };
  areasIntro: { title: string; lead: string };
  areas: TourArea[];
  architecture: {
    title: string;
    lead: string;
    stack: { title: string; lead: string; layers: TourLayer[]; scale: string };
    request: {
      title: string;
      lead: string;
      lanes: { id: string; label: string; note: string }[];
      steps: TourRequestStep[];
    };
    modules: {
      title: string;
      lead: string;
      groups: { id: string; label: string }[];
      items: TourModuleInfo[];
      dependsOn: string;
      toggleTitle: string;
      toggleBody: string;
      toggleShot: TourShot;
      toggleMarks: TourMark[];
      rule: string;
    };
    config: {
      title: string;
      lead: string;
      configTitle: string;
      configItems: { title: string; body: string }[];
      codeTitle: string;
      codeItems: { title: string; body: string }[];
      rule: string;
      shot: TourShot;
    };
    deploy: {
      title: string;
      lead: string;
      items: { icon: TourIcon; title: string; body: string }[];
    };
  };
  ai: {
    title: string;
    lead: string;
    pipeline: { id: string; icon: TourIcon; title: string; body: string }[];
    mask: {
      title: string;
      lead: string;
      labels: { original: string; masked: string; reply: string; restored: string };
      original: string;
      masked: string;
      reply: string;
      restored: string;
    };
    modes: {
      title: string;
      builtin: { title: string; body: string };
      model: { title: string; body: string };
    };
  };
  security: {
    title: string;
    lead: string;
    gates: TourGate[];
    pass: string;
    shot: TourShot;
    shotNote: string;
  };
  journeys: { title: string; lead: string; items: TourJourney[]; guideCta: string };
  polish: {
    title: string;
    lead: string;
    langs: { locale: 'en' | 'zh-TW' | 'ja-JP'; label: string; shot: TourShot }[];
    dark: { label: string; shot: TourShot };
    points: { icon: TourIcon; title: string; body: string }[];
  };
  roles: { title: string; lead: string; items: TourRole[] };
  closing: {
    title: string;
    lead: string;
    actions: { label: string; kind: 'product' | 'guide'; slug?: string }[];
    footnote: string;
  };
}
