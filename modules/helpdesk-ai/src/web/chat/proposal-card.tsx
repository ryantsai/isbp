'use client';

import { Button } from '@astryxdesign/core/Button';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Card, CardContent, CardHeader, CardTitle } from '@isbp/ui/card';
import { IconTile } from '@isbp/ui/icon-tile';
import { TicketPlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { TicketProposal } from '../../contracts';

/** The impact scale of ITSM's "Report an issue" (same wording, same order): urgency 1 … 3. */
const IMPACT = [
  { urgency: 1, key: 'blocked' },
  { urgency: 2, key: 'slow' },
  { urgency: 3, key: 'minor' },
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
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onCreate({ title: title.trim(), description: description.trim(), urgency, type });
      }}
    >
      <Card>
        <CardHeader>
          <HStack gap={2} vAlign="start">
            <IconTile size="sm" aria-hidden>
              <TicketPlusIcon />
            </IconTile>
            <VStack gap={0.5} className="min-w-0">
              <CardTitle id={`${id}-title`}>{t('proposal.title')}</CardTitle>
              <Text type="supporting" color="secondary">
                {t('proposal.hint')}
              </Text>
            </VStack>
          </HStack>
        </CardHeader>
        <CardContent>
          <FormLayout defaultOptionality="required">
            <TextInput
              label={t('proposal.fields.title')}
              value={title}
              onChange={(v) => setTitle(v.slice(0, 200))}
              status={invalid ? { type: 'error', message: t('proposal.titleTooShort') } : undefined}
            />
            <TextArea
              label={t('proposal.fields.description')}
              isOptional
              rows={4}
              value={description}
              onChange={(v) => setDescription(v.slice(0, 20_000))}
            />
            <RadioList
              label={t('proposal.impactLegend')}
              value={String(urgency)}
              onChange={(v) => setUrgency(Number(v))}
            >
              {IMPACT.map((o) => (
                <RadioListItem
                  key={o.key}
                  value={String(o.urgency)}
                  label={t(`proposal.impact.${o.key}`)}
                  description={t(`proposal.impact.${o.key}Hint`)}
                />
              ))}
            </RadioList>
            <Selector
              label={t('proposal.fields.type')}
              value={type}
              onChange={(v) => setType(v as TicketProposal['type'])}
              options={[
                { value: 'incident', label: t('proposal.type.incident') },
                { value: 'service_request', label: t('proposal.type.service_request') },
              ]}
              width={288}
            />
          </FormLayout>
        </CardContent>
        <CardContent>
          <HStack gap={2} wrap="wrap">
            <Button
              label={t('proposal.create')}
              variant="primary"
              size="sm"
              icon={<Icon icon={TicketPlusIcon} />}
              isLoading={creating}
              isDisabled={invalid}
              type="submit"
            />
            <Button
              label={t('proposal.notNow')}
              variant="ghost"
              size="sm"
              isDisabled={creating}
              type="button"
              onClick={onDismiss}
            />
          </HStack>
        </CardContent>
      </Card>
    </form>
  );
}
