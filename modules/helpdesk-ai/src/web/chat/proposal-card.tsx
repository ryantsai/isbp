'use client';

import { Button } from '@isbp/ui/button';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { LifeBuoyIcon, TicketPlusIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { TicketProposal } from '../../contracts';

/**
 * The virtual agent's suggested ticket. Nothing is created until the user confirms — they can edit the
 * title, description and urgency first, or say "Not now".
 */
export function ProposalCard({
  proposal,
  expanded,
  onExpand,
  onDismiss,
  onCreate,
  creating,
}: {
  proposal: TicketProposal;
  expanded: boolean;
  onExpand: () => void;
  onDismiss: () => void;
  onCreate: (p: TicketProposal) => void;
  creating: boolean;
}) {
  const t = useTranslations('helpdesk-ai');
  const id = useId();
  const [title, setTitle] = useState(proposal.title);
  const [description, setDescription] = useState(proposal.description);
  const [urgency, setUrgency] = useState(String(proposal.urgency));
  const [type, setType] = useState<TicketProposal['type']>(proposal.type);
  const invalid = title.trim().length < 3;

  return (
    <AnimatePresence initial={false} mode="wait">
      {expanded ? (
        <motion.form
          key="form"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          aria-labelledby={`${id}-title`}
          className="space-y-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/8 via-card to-card p-4 shadow-xs"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid)
              onCreate({
                title: title.trim(),
                description: description.trim(),
                urgency: Number(urgency),
                type,
              });
          }}
        >
          <div className="flex items-start gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
              <TicketPlusIcon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 id={`${id}-title`} className="text-sm font-semibold">
                {t('proposal.title')}
              </h3>
              <p className="text-xs text-muted-foreground">{t('proposal.hint')}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-t`}>{t('proposal.fields.title')}</Label>
            <Input
              id={`${id}-t`}
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${id}-terr` : undefined}
            />
            {invalid && (
              <p id={`${id}-terr`} className="text-xs text-destructive">
                {t('proposal.titleTooShort')}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-d`}>{t('proposal.fields.description')}</Label>
            <Textarea
              id={`${id}-d`}
              value={description}
              maxLength={20_000}
              onChange={(e) => setDescription(e.target.value)}
              className="max-h-48 min-h-24 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${id}-u`}>{t('proposal.fields.urgency')}</Label>
              <Select value={urgency} onValueChange={setUrgency}>
                <SelectTrigger id={`${id}-u`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['1', '2', '3'].map((u) => (
                    <SelectItem key={u} value={u}>
                      {t(`proposal.urgency.${u}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${id}-k`}>{t('proposal.fields.type')}</Label>
              <Select value={type} onValueChange={(v) => setType(v as TicketProposal['type'])}>
                <SelectTrigger id={`${id}-k`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incident">{t('proposal.type.incident')}</SelectItem>
                  <SelectItem value="service_request">{t('proposal.type.service_request')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" size="sm" loading={creating} disabled={invalid}>
              <TicketPlusIcon /> {t('proposal.create')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDismiss} disabled={creating}>
              {t('proposal.notNow')}
            </Button>
          </div>
        </motion.form>
      ) : (
        <motion.div
          key="cta"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm"
        >
          <LifeBuoyIcon className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 text-muted-foreground">{t('proposal.cta')}</span>
          <Button size="sm" variant="outline" onClick={onExpand}>
            {t('proposal.review')}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
