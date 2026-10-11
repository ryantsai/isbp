import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { VStack } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { IconTile } from '@isbp/ui/icon-tile';
import { CompassIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export default async function RootNotFound() {
  const t = await getTranslations('shell');
  return (
    <main className="grid min-h-dvh place-items-center p-5">
      <div className="max-w-sm">
        <VStack gap={3} hAlign="center">
          <IconTile aria-hidden size="lg">
            <CompassIcon />
          </IconTile>
          <Heading level={1} justify="center">
            {t('notFoundTitle')}
          </Heading>
          <Text color="secondary" justify="center">
            {t('notFoundBody')}
          </Text>
          <Button label={t('goHome')} variant="secondary" href="/" />
        </VStack>
      </div>
    </main>
  );
}
