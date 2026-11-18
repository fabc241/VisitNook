import { StyleSheet, Text, View } from 'react-native';

type Props = { title: string; body: string };

export function Placeholder({ title, body }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  body: { fontSize: 16, color: '#666', textAlign: 'center' },
});
