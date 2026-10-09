'use client';

import { localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { duration, ease, useReducedMotion } from '@isbp/ui/motion';
import { AnimatePresence, motion, type Transition } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Impact } from '../contracts';
import { ClassIcon } from './class-icon';
import { ciHref } from './data';
import {
  fitText,
  type ImpactBand,
  layoutImpact,
  NODE_H,
  NODE_W,
  nodesPerRow,
  PAD,
  pathToRoot,
  type PlacedEdge,
  type PlacedNode,
  textWidth,
} from './impact-layout';

const STATUS_DOT: Record<string, string> = {
  planned: 'fill-info',
  in_use: 'fill-success',
  maintenance: 'fill-warning',
  retired: 'fill-muted-foreground',
};

/**
 * Motion only where the graph changes (a new depth, a CI added or removed): nodes and labels move to their new
 * place, new ones fade in, removed ones fade out. Nothing animates on the first render; reduced motion = instant.
 */
function useGraphTransition(): Transition {
  const reduce = useReducedMotion();
  return reduce ? { duration: 0 } : { duration: duration.base, ease: ease.move };
}

/** Dims what isn't on the highlighted path (opacity only, 120 ms). */
const DIM = 'transition-opacity duration-(--motion-fast) motion-reduce:transition-none';

function edgePoints(edge: PlacedEdge) {
  const x1 = edge.upper.x + NODE_W / 2;
  const y1 = edge.upper.y + NODE_H;
  const x2 = edge.lower.x + NODE_W / 2;
  const y2 = edge.lower.y;
  return { x1, y1, x2, y2, midY: (y1 + y2) / 2 };
}

const towardsService = (edge: PlacedEdge) =>
  Boolean(edge.upper.node?.isService && edge.upper.side === 'impacted');

function EdgePath({ edge, state }: { edge: PlacedEdge; state: 'on' | 'off' | 'idle' }) {
  const transition = useGraphTransition();
  const { x1, y1, x2, y2, midY } = edgePoints(edge);
  const service = towardsService(edge);
  const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  return (
    <g className={cn(DIM, state === 'off' && 'opacity-30')}>
      <motion.path
        initial={{ opacity: 0, d }}
        animate={{ opacity: 1, d }}
        exit={{ opacity: 0 }}
        transition={transition}
        className={cn(
          'fill-none transition-[stroke] duration-(--motion-fast) motion-reduce:transition-none',
          state === 'on'
            ? service
              ? 'stroke-destructive'
              : 'stroke-primary'
            : service
              ? 'stroke-destructive/60'
              : 'stroke-muted-foreground/35',
        )}
        strokeWidth={state === 'on' ? 2.5 : service ? 2 : 1.25}
      />
    </g>
  );
}

/** The relationship, read from the upper node, placed right next to the found CI's end of the edge. */
function EdgeLabel({ edge, state }: { edge: PlacedEdge; state: 'on' | 'off' | 'idle' }) {
  const t = useTranslations('cmdb.relationships');
  const transition = useGraphTransition();
  const { x1, y1, x2, y2 } = edgePoints(edge);
  const label = t(`${edge.type}.${edge.direction === 'outgoing' ? 'forward' : 'reverse'}`);
  const lw = Math.max(44, textWidth(label, 10) + 16);
  const [lx, ly] = edge.child === 'upper' ? [x1, y1 + 20] : [x2, y2 - 20];
  const at = { x: lx - lw / 2, y: ly - 9 };
  return (
    <motion.g
      initial={{ opacity: 0, ...at }}
      animate={{ opacity: 1, ...at }}
      exit={{ opacity: 0 }}
      transition={transition}
    >
      <g className={cn(DIM, state === 'off' && 'opacity-30')}>
        <rect
          width={lw}
          height={18}
          rx={9}
          className={cn('fill-card', towardsService(edge) ? 'stroke-destructive/50' : 'stroke-border')}
          strokeWidth={1}
        />
        <text x={lw / 2} y={12.5} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {label}
        </text>
      </g>
    </motion.g>
  );
}

/** A small label on a node's top edge ("Business service", "This CI"). */
function Pill({
  x,
  y,
  text,
  align,
  tone,
}: {
  x: number;
  y: number;
  text: string;
  align: 'start' | 'end';
  tone: 'danger' | 'primary';
}) {
  const w = textWidth(text, 10) + 16;
  return (
    <g transform={`translate(${align === 'end' ? x - w : x} ${y})`}>
      <rect
        width={w}
        height={18}
        rx={9}
        className={tone === 'danger' ? 'fill-destructive' : 'fill-primary'}
      />
      <text
        x={w / 2}
        y={12.5}
        textAnchor="middle"
        className={cn(
          'text-[10px] font-medium',
          tone === 'danger' ? 'fill-white dark:fill-black' : 'fill-primary-foreground',
        )}
      >
        {text}
      </text>
    </g>
  );
}

/**
 * "↑ Affected if it fails 8" above the analysed CI and "↓ Depends on 5" below it, so the two halves of the graph
 * can't be mistaken for each other. A dashed rule continues the label across the graph.
 */
function BandLabel({ band, width }: { band: ImpactBand; width: number }) {
  const t = useTranslations('cmdb.impact');
  const transition = useGraphTransition();
  const label = band.side === 'impacted' ? t('impacted') : t('dependsOn');
  const count = String(band.count);
  const textW = textWidth(label, 11) + textWidth(count, 11) + 6;
  const w = textW + 30;
  const up = band.side === 'impacted';
  return (
    <motion.g initial={{ y: band.y }} animate={{ y: band.y }} transition={transition} aria-hidden>
      <line
        x1={PAD + w + 6}
        x2={width - PAD}
        y1={0}
        y2={0}
        className="stroke-border"
        strokeDasharray="4 4"
        strokeWidth={1}
      />
      <g transform={`translate(${PAD} -11)`}>
        <rect
          width={w}
          height={22}
          rx={11}
          className={cn(
            'stroke-1',
            up ? 'fill-destructive/8 stroke-destructive/40' : 'fill-muted stroke-border',
          )}
        />
        {/* An arrow pointing at the side it names. */}
        <path
          d={
            up
              ? 'M 13 15 L 13 7 M 9.5 10.5 L 13 7 L 16.5 10.5'
              : 'M 13 7 L 13 15 M 9.5 11.5 L 13 15 L 16.5 11.5'
          }
          className={cn('fill-none', up ? 'stroke-destructive' : 'stroke-muted-foreground')}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          x={24}
          y={15}
          className={cn('text-[11px] font-medium', up ? 'fill-destructive' : 'fill-foreground')}
        >
          {label}
          <tspan dx={6} className="fill-muted-foreground font-normal tabular-nums">
            {count}
          </tspan>
        </text>
      </g>
    </motion.g>
  );
}

function Node({
  node,
  label,
  state,
  onActive,
}: {
  node: PlacedNode;
  label: string;
  state: 'on' | 'off' | 'idle';
  onActive: (key: string | null) => void;
}) {
  const t = useTranslations('cmdb');
  const router = useRouter();
  const locale = useLocale();
  const transition = useGraphTransition();
  const isRoot = node.side === 'root';
  const service = Boolean(node.node?.isService && node.side === 'impacted');
  const href = ciHref(node.ci);
  const className = localize(node.ci.class.name, locale);
  const at = { x: node.x, y: node.y };
  return (
    <motion.g
      initial={{ opacity: 0, ...at }}
      animate={{ opacity: 1, ...at }}
      exit={{ opacity: 0 }}
      transition={transition}
      onPointerEnter={() => onActive(node.key)}
      onPointerLeave={() => onActive(null)}
    >
      <a
        href={href}
        aria-label={label}
        className={cn('group cursor-pointer outline-none', DIM, state === 'off' && 'opacity-55')}
        onFocus={() => onActive(node.key)}
        onBlur={() => onActive(null)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          router.push(href);
        }}
      >
        <title>{`${node.ci.reference} ${node.ci.name} · ${className}`}</title>
        <rect
          x={-3}
          y={-3}
          width={NODE_W + 6}
          height={NODE_H + 6}
          rx={13}
          className="fill-none stroke-ring/60 opacity-0 transition-opacity group-focus-visible:opacity-100"
          strokeWidth={3}
        />
        {/* Opaque base: tinted fills must not let the edges behind show through. */}
        <rect width={NODE_W} height={NODE_H} rx={10} className="fill-card" />
        <rect
          width={NODE_W}
          height={NODE_H}
          rx={10}
          className={cn(
            'transition-colors',
            isRoot
              ? 'fill-primary/10 stroke-primary'
              : service
                ? 'fill-destructive/8 stroke-destructive/70 group-hover:stroke-destructive'
                : 'fill-card stroke-border group-hover:stroke-ring',
          )}
          strokeWidth={isRoot || service ? 2 : 1}
        />
        <g transform="translate(10 14)">
          <rect width={28} height={28} rx={7} className={isRoot ? 'fill-primary/15' : 'fill-primary/10'} />
          <g transform="translate(6 6)" className="text-primary">
            <ClassIcon name={node.ci.class.icon} width={16} height={16} />
          </g>
        </g>
        <text x={46} y={24} className="fill-foreground text-[12px] font-semibold">
          {fitText(node.ci.name, 18)}
        </text>
        <circle cx={50} cy={38} r={3} className={STATUS_DOT[node.ci.status]} />
        <text x={58} y={42} className="fill-muted-foreground text-[10.5px]">
          {fitText(`${node.ci.reference} · ${t(`status.${node.ci.status}`)}`, 22)}
        </text>
        {service && <Pill x={NODE_W - 12} y={-9} align="end" text={t('impact.service')} tone="danger" />}
        {isRoot && <Pill x={12} y={-9} align="start" text={t('impact.thisCi')} tone="primary" />}
      </a>
    </motion.g>
  );
}

/**
 * Layered impact diagram: impacted CIs above (deepest first) under "Affected if it fails", the analysed CI in the
 * middle, what it depends on below under "Depends on". Nodes are links; edges carry the relationship, read from the
 * upper node. Pointing at (or focusing) a CI highlights its path to the analysed CI: how the failure travels.
 */
export function ImpactGraph({ impact }: { impact: Impact }) {
  const t = useTranslations('cmdb');
  const locale = useLocale();
  // Wide levels wrap to the space available, so the graph rarely needs sideways scrolling.
  const box = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState(5);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPerRow(nodesPerRow(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(() => layoutImpact(impact, perRow), [impact, perRow]);
  const path = useMemo(() => pathToRoot(layout, active), [layout, active]);
  const highlighting = path.size > 1;
  const stateOf = (key: string) => (!highlighting ? 'idle' : path.has(key) ? 'on' : 'off');
  const nodeLabel = (n: PlacedNode) => {
    const base = t('impact.nodeLabel', {
      reference: n.ci.reference,
      name: n.ci.name,
      className: localize(n.ci.class.name, locale),
      status: t(`status.${n.ci.status}`),
    });
    if (n.side === 'root') return `${t('impact.thisCi')}: ${base}`;
    const parts = [
      base,
      t('impact.level', { depth: n.node!.depth }),
      n.side === 'impacted' ? t('impact.impacted') : t('impact.dependsOn'),
    ];
    if (n.node!.isService && n.side === 'impacted') parts.push(t('impact.service'));
    return parts.join(', ');
  };
  // Read order for keyboard and screen readers: top to bottom, left to right.
  const ordered = [...layout.nodes].sort((a, b) => a.row - b.row || a.x - b.x);

  return (
    <div ref={box} className="overflow-x-auto rounded-lg border bg-muted/20">
      <svg
        role="group"
        aria-label={t('impact.graphLabel', {
          name: impact.root.name,
          impacted: impact.impacted.length,
          dependsOn: impact.dependsOn.length,
        })}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="mx-auto block max-w-none select-none"
      >
        <g aria-hidden>
          {layout.bands.map((b) => (
            <BandLabel key={b.side} band={b} width={layout.width} />
          ))}
          <AnimatePresence initial={false}>
            {layout.edges.map((e) => (
              <EdgePath key={e.key} edge={e} state={stateOf(e.key)} />
            ))}
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {layout.edges.map((e) => (
              <EdgeLabel key={e.key} edge={e} state={stateOf(e.key)} />
            ))}
          </AnimatePresence>
        </g>
        <AnimatePresence initial={false}>
          {ordered.map((n) => (
            <Node
              key={n.key}
              node={n}
              label={nodeLabel(n)}
              state={n.side === 'root' ? 'idle' : stateOf(n.key)}
              onActive={setActive}
            />
          ))}
        </AnimatePresence>
      </svg>
    </div>
  );
}
