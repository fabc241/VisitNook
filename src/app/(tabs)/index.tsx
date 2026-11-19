import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function VisitsScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.empty}>
        <Text style={styles.title}>Your visits</Text>
        <Text style={styles.body}>Recorded visits will appear here.</Text>
      </View>
      <Link href="/setup" asChild>
        <Pressable style={styles.modelsButton}>
          <Text style={styles.modelsText}>On-device models</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  body: { fontSize: 16, color: '#666', textAlign: 'center' },
  modelsButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F6FEB',
    paddingVertical: 14,
    alignItems: 'center',
  },
  modelsText: { color: '#1F6FEB', fontSize: 16, fontWeight: '600' },
});
