'use client';

import { cn } from '@isbp/ui';
import { Button } from '@isbp/ui/button';
import { Input } from '@isbp/ui/input';
import { Label } from '@isbp/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@isbp/ui/select';
import { Textarea } from '@isbp/ui/textarea';
import { CircleSlashIcon, FeatherIcon, SnailIcon, TicketPlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { TicketProposal } from '../../contracts';

/** The impact scale of ITSM's "Report an issue" (same wording, same order): urgency 1 … 3. */
const IMPACT = [
  { urgency: 1, key: 'blocked', icon: CircleSlashIcon },
  { urgency: 2, key: 'slow', icon: SnailIcon },
  { urgency: 3, key: 'minor', icon: FeatherIcon },
] as const;

/**
 * The ticket the virtual agent prepared. Nothing is created until the user confirms — they can edit the title,
 * description, how much it affects them and the type first, or say "Not now".
 */
export function ProposalCard({
  proposal,
  onDismiss,
  onCreate,
  creating,
}: {
  proposal: TicketProposal;
  onDismiss: () => void;
  onCreate: (p: TicketProposal) => void;
  creating: boolean;
}) {
  const t = useTranslations('helpdesk-ai');
  const id = useId();
  const [title, setTitle] = useState(proposal.title);
  const [description, setDescription] = useState(proposal.description);
  const [urgency, setUrgency] = useState(proposal.urgency);
  const [type, setType] = useState<TicketProposal['type']>(proposal.type);
  const invalid = title.trim().length < 3;

  return (
    <form
      aria-labelledby={`${id}-title`}
      className="@container space-y-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/8 via-card to-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onCreate({ title: title.trim(), description: description.trim(), urgency, type });
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
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium">{t('proposal.impactLegend')}</legend>
        <div className="grid grid-cols-1 gap-2 @lg:grid-cols-3">
          {IMPACT.map((o) => {
            const Icon = o.icon;
            const checked = urgency === o.urgency;
            return (
              <label
                key={o.key}
                className={cn(
                  'flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border bg-card p-2.5 transition-colors hover:bg-accent/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 motion-reduce:transition-none',
                  checked && 'border-primary bg-primary/5',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-urgency`}
                  value={o.urgency}
                  checked={checked}
                  onChange={() => setUrgency(o.urgency)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-md',
                    checked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-medium">{t(`proposal.impact.${o.key}`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`proposal.impact.${o.key}Hint`)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-k`}>{t('proposal.fields.type')}</Label>
        <Select value={type} onValueChange={(v) => setType(v as TicketProposal['type'])}>
          <SelectTrigger id={`${id}-k`} className="w-full @lg:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="incident">{t('proposal.type.incident')}</SelectItem>
            <SelectItem value="service_request">{t('proposal.type.service_request')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" size="sm" loading={creating} disabled={invalid}>
          <TicketPlusIcon /> {t('proposal.create')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss} disabled={creating}>
          {t('proposal.notNow')}
        </Button>
      </div>
    </form>
  );
}
