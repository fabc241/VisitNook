import '../qvac/worker';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { allCached, getCacheStatus } from '../qvac/models';
import { setModelsReady, useModelsReady } from '../qvac/readiness';

export default function RootLayout() {
  const ready = useModelsReady();

  // On launch, check the model cache. Until every model is on the device the
  // tabs stay locked and the app shows the setup (download) screen.
  useEffect(() => {
    getCacheStatus()
      .then((status) => setModelsReady(allCached(status)))
      .catch(() => setModelsReady(false));
  }, []);

  if (ready === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Protected guard={ready} redirectTo="/setup">
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="setup" options={{ title: 'Models', headerShown: ready }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
