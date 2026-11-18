import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#1F6FEB' }}>
      <Tabs.Screen name="index" options={{ title: 'Visits' }} />
      <Tabs.Screen name="record" options={{ title: 'Record' }} />
      <Tabs.Screen name="ask" options={{ title: 'Ask' }} />
      <Tabs.Screen name="prep" options={{ title: 'Prep' }} />
    </Tabs>
  );
}
