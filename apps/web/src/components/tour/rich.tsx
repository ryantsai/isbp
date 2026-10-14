import { Text } from '@astryxdesign/core/Text';
import { Fragment } from 'react';

/**
 * Copy with labels in `**bold**`, exactly as the screen shows them (the guides write them the same way): the labels
 * become semibold text, everything else is left alone. No other Markdown is read.
 */
export function Rich({ text }: { text: string }) {
  const parts = text.split('**');
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <Text key={i} type="inherit" weight="semibold">
            {part}
          </Text>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** The text of a `Rich` string without its marks (for accessible names and `alt`). */
export const plain = (text: string) => text.replaceAll('**', '');
