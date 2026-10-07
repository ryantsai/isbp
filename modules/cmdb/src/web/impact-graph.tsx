'use client';

import { localize } from '@isbp/sdk';
import { cn } from '@isbp/ui';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Impact } from '../contracts';
import { ClassIcon } from './class-icon';
import { ciHref } from './data';
import {
  fitText,
  layoutImpact,
  NODE_H,
  NODE_W,
  nodesPerRow,
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

function edgePoints(edge: PlacedEdge) {
  const x1 = edge.upper.x + NODE_W / 2;
  const y1 = edge.upper.y + NODE_H;
  const x2 = edge.lower.x + NODE_W / 2;
  const y2 = edge.lower.y;
  return { x1, y1, x2, y2, midY: (y1 + y2) / 2 };
}

const towardsService = (edge: PlacedEdge) =>
  Boolean(edge.upper.node?.isService && edge.upper.side === 'impacted');

function EdgePath({ edge, index }: { edge: PlacedEdge; index: number }) {
  const { x1, y1, x2, y2, midY } = edgePoints(edge);
  const service = towardsService(edge);
  return (
    <motion.path
      d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
      className={cn('fill-none', service ? 'stroke-destructive/60' : 'stroke-muted-foreground/35')}
      strokeWidth={service ? 2 : 1.25}
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.45, delay: 0.08 + Math.min(index, 24) * 0.015, ease: 'easeOut' }}
    />
  );
}

/** The relationship, read from the upper node, placed right next to the found CI's end of the edge. */
function EdgeLabel({ edge }: { edge: PlacedEdge }) {
  const t = useTranslations('cmdb.relationships');
  const { x1, y1, x2, y2 } = edgePoints(edge);
  const label = t(`${edge.type}.${edge.direction === 'outgoing' ? 'forward' : 'reverse'}`);
  const lw = Math.max(44, textWidth(label, 10) + 16);
  const [lx, ly] = edge.child === 'upper' ? [x1, y1 + 20] : [x2, y2 - 20];
  return (
    <g transform={`translate(${lx - lw / 2} ${ly - 9})`}>
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

function Node({ node, index, label }: { node: PlacedNode; index: number; label: string }) {
  const t = useTranslations('cmdb');
  const router = useRouter();
  const locale = useLocale();
  const isRoot = node.side === 'root';
  const service = Boolean(node.node?.isService && node.side === 'impacted');
  const href = ciHref(node.ci);
  const className = localize(node.ci.class.name, locale);
  return (
    <motion.g
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 30) * 0.02, ease: [0.22, 1, 0.36, 1] }}
    >
      <a
        href={href}
        aria-label={label}
        className="group cursor-pointer outline-none"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          router.push(href);
        }}
      >
        <title>{`${node.ci.reference} ${node.ci.name} · ${className}`}</title>
        <rect
          x={node.x - 3}
          y={node.y - 3}
          width={NODE_W + 6}
          height={NODE_H + 6}
          rx={13}
          className="fill-none stroke-ring/60 opacity-0 transition-opacity group-focus-visible:opacity-100"
          strokeWidth={3}
        />
        {/* Opaque base: tinted fills must not let the edges behind show through. */}
        <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={10} className="fill-card" />
        <rect
          x={node.x}
          y={node.y}
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
        <g transform={`translate(${node.x + 10} ${node.y + 14})`}>
          <rect width={28} height={28} rx={7} className={isRoot ? 'fill-primary/15' : 'fill-primary/10'} />
          <g transform="translate(6 6)" className="text-primary">
            <ClassIcon name={node.ci.class.icon} width={16} height={16} />
          </g>
        </g>
        <text x={node.x + 46} y={node.y + 24} className="fill-foreground text-[12px] font-semibold">
          {fitText(node.ci.name, 18)}
        </text>
        <circle cx={node.x + 50} cy={node.y + 38} r={3} className={STATUS_DOT[node.ci.status]} />
        <text x={node.x + 58} y={node.y + 42} className="fill-muted-foreground text-[10.5px]">
          {fitText(`${node.ci.reference} · ${t(`status.${node.ci.status}`)}`, 22)}
        </text>
        {service && (
          <Pill
            x={node.x + NODE_W - 12}
            y={node.y - 9}
            align="end"
            text={t('impact.service')}
            tone="danger"
          />
        )}
        {isRoot && (
          <Pill x={node.x + 12} y={node.y - 9} align="start" text={t('impact.thisCi')} tone="primary" />
        )}
      </a>
    </motion.g>
  );
}

/**
 * Layered impact diagram: impacted CIs above (deepest first), the analysed CI in the middle, what it
 * depends on below. Nodes are links; edges carry the relationship, read from the upper node.
 */
export function ImpactGraph({ impact }: { impact: Impact }) {
  const t = useTranslations('cmdb');
  const locale = useLocale();
  // Wide levels wrap to the space available, so the graph rarely needs sideways scrolling.
  const box = useRef<HTMLDivElement>(null);
  const [perRow, setPerRow] = useState(5);
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
          {layout.edges.map((e, i) => (
            <EdgePath key={e.key} edge={e} index={i} />
          ))}
          {layout.edges.map((e) => (
            <EdgeLabel key={e.key} edge={e} />
          ))}
        </g>
        {ordered.map((n, i) => (
          <Node key={n.key} node={n} index={i} label={nodeLabel(n)} />
        ))}
      </svg>
    </div>
  );
}
