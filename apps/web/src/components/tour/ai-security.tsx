'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { ArrowRightIcon, CheckIcon, RotateCcwIcon } from 'lucide-react';
import { type CSSProperties, Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import type { TourContent } from './content';
import { Reveal, Sequence, prefersReducedMotion } from './motion';
import { BlockHead, SectionHead, TileIcon } from './parts';
import { Rich } from './rich';
import { ShotImage } from './shot';

const PII = /([\w.+-]+@[\w-]+(?:\.[\w-]+)+|\d{1,3}(?:\.\d{1,3}){3}|\[[A-Z]+_\d+\])/g;

/** A line of the masking demo: the values that are personal (or their stand-ins) are highlighted. */
function Marked({ text }: { text: string }): ReactNode {
  return text.split(PII).map((part, i) =>
    i % 2 ? (
      <mark key={i} className="tour-pii" data-masked={part.startsWith('[')}>
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/**
 * What the gateway does to a question, line by line: what you type, what the model is sent, what it answers and what
 * you read. It plays once when it comes into view and can be replayed; with reduced motion all four lines show.
 */
function MaskDemo({ content }: { content: TourContent }) {
  const { mask } = content.ai;
  const { chrome } = content;
  const [phase, setPhase] = useState(4);
  const [run, setRun] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  // First time on screen: start from the first line.
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        setPhase(0);
        setRun((r) => r + 1);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Each line arrives 1.6 s after the one before.
  useEffect(() => {
    if (run === 0) return;
    setPhase(0);
    const timers = [1, 2, 3, 4].map((n) => window.setTimeout(() => setPhase(n), n * 1600 - 800));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [run]);

  const rows = [
    { key: 'original', label: mask.labels.original, text: mask.original, tone: 'neutral' as const },
    { key: 'masked', label: mask.labels.masked, text: mask.masked, tone: 'info' as const },
    { key: 'reply', label: mask.labels.reply, text: mask.reply, tone: 'info' as const },
    { key: 'restored', label: mask.labels.restored, text: mask.restored, tone: 'success' as const },
  ];
  return (
    <div ref={root} className="tour-stack-sm">
      <BlockHead title={mask.title} lead={mask.lead} />
      <Card padding={5}>
        <VStack gap={4}>
          <ol className="tour-mask">
            {rows.map((r, i) => (
              <li key={r.key} data-shown={phase >= i + 1} data-key={r.key}>
                <Badge variant={r.tone} label={r.label} />
                <Text as="p" className="tour-mask-text">
                  <Marked text={r.text} />
                </Text>
              </li>
            ))}
          </ol>
          <div>
            <Button
              variant="ghost"
              size="sm"
              label={chrome.replay}
              icon={<Icon icon={RotateCcwIcon} />}
              onClick={() => {
                setPhase(0);
                setRun((r) => r + 1);
              }}
            />
          </div>
        </VStack>
      </Card>
    </div>
  );
}

export function AiSection({ content, locale }: { content: TourContent; locale: string }) {
  const { ai } = content;
  void locale;
  return (
    <section id="ai-gateway" className="tour-section" aria-labelledby="ai-gateway-title">
      <div className="tour-wrap tour-stack">
        <SectionHead id="ai-gateway-title" title={ai.title} lead={ai.lead} />
        <Sequence as="ol" className="tour-pipe">
          {ai.pipeline.map((p, i) => (
            <li key={p.id} className="tour-pipe-step" style={{ '--i': i } as CSSProperties}>
              <Card padding={4} height="100%">
                <VStack gap={3}>
                  <HStack gap={2} vAlign="center" hAlign="between">
                    <TileIcon name={p.icon} size="sm" />
                    <Text type="supporting" color="secondary" hasTabularNumbers>
                      {i + 1}
                    </Text>
                  </HStack>
                  <Text weight="semibold">{p.title}</Text>
                  <Text type="supporting" color="secondary" as="p" textWrap="pretty">
                    {p.body}
                  </Text>
                </VStack>
              </Card>
              {i < ai.pipeline.length - 1 && (
                <span className="tour-pipe-next" aria-hidden>
                  <Icon icon={ArrowRightIcon} color="secondary" />
                </span>
              )}
            </li>
          ))}
        </Sequence>
        <MaskDemo content={content} />
        <div className="tour-stack-sm">
          <BlockHead title={ai.modes.title} />
          <Grid columns={{ minWidth: 300, max: 2 }} gap={3}>
            {[ai.modes.builtin, ai.modes.model].map((m, i) => (
              <Reveal key={m.title} delay={i * 80}>
                <Card padding={5} height="100%" variant={i === 0 ? 'blue' : 'muted'}>
                  <VStack gap={2}>
                    <Text type="large" weight="semibold">
                      {m.title}
                    </Text>
                    <Text as="p" textWrap="pretty">
                      <Rich text={m.body} />
                    </Text>
                  </VStack>
                </Card>
              </Reveal>
            ))}
          </Grid>
        </div>
      </div>
    </section>
  );
}

/**
 * The eight checks every request passes, lit one after the other as the section comes into view, and the screen where
 * the narrowest of them (a role limited to one department, one record and an end date) is set.
 */
export function SecuritySection({ content, locale }: { content: TourContent; locale: string }) {
  const { security } = content;
  return (
    <section
      id="security-model"
      className="tour-section"
      data-tone="surface"
      aria-labelledby="security-model-title"
    >
      <div className="tour-wrap tour-stack">
        <SectionHead id="security-model-title" title={security.title} lead={security.lead} />
        <Sequence as="ol" className="tour-gates" threshold={0.2}>
          {security.gates.map((g, i) => (
            <li key={g.title} className="tour-gate" style={{ '--i': i } as CSSProperties}>
              <Card padding={4} height="100%">
                <VStack gap={3}>
                  <HStack gap={2} vAlign="center" hAlign="between">
                    <TileIcon name={g.icon} size="sm" />
                    <span className="tour-gate-pass">
                      <Icon icon={CheckIcon} size="sm" color="success" />
                      <Text type="supporting" color="secondary">
                        {security.pass}
                      </Text>
                    </span>
                  </HStack>
                  <Text weight="semibold">
                    {i + 1}. {g.title}
                  </Text>
                  <Text type="supporting" color="secondary" as="p" textWrap="pretty">
                    {g.body}
                  </Text>
                </VStack>
              </Card>
            </li>
          ))}
        </Sequence>
        <div className="tour-split">
          <Reveal>
            <VStack gap={3}>
              <Text type="large" weight="semibold" as="p">
                {security.gates[3]?.title}
              </Text>
              <Text as="p" textWrap="pretty">
                {security.shotNote}
              </Text>
            </VStack>
          </Reveal>
          <Reveal delay={80}>
            <ShotImage shot={security.shot} locale={locale} className="tour-shot-frame" />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
