import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import type { Range } from '../search/visits';

type Props = {
  text: string;
  /** Sorted, non-overlapping [start, end) ranges to highlight. */
  highlights: Range[];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/** Text with search matches in bold on a yellow background. */
export function HighlightedText({ text, highlights, style, numberOfLines }: Props) {
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [start, end] of highlights) {
    if (start > at) parts.push({ text: text.slice(at, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        part.hit ? (
          <Text key={i} style={styles.hit}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  hit: { fontWeight: '700', backgroundColor: 'rgba(255,212,59,0.55)', color: '#24292F' },
});
