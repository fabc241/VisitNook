import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addFollowUpToCalendar, CalendarAccessDenied } from '../features/reminders';
import {
  addDays,
  clampDay,
  dayLabel,
  daysBetween,
  EVENT_TITLE,
  initialDay,
  suggestionText,
  toDay,
  type ReminderCandidate,
} from '../reminders/plan';

/** The "Add to Calendar" button under a next step, and its confirmation sheet. */
export function FollowUpReminder({
  visitId,
  candidate,
  onAdded,
}: {
  visitId: string;
  candidate: ReminderCandidate;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { added } = candidate;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens a sheet to confirm the date before anything is added"
        onPress={() => setOpen(true)}
        style={[styles.inlineButton, added && styles.inlineButtonDone]}
      >
        <Text style={[styles.inlineText, added && styles.inlineTextDone]}>
          {added ? `✓ In Calendar · ${dayLabel(added.day)}` : 'Add to Calendar…'}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        {open && (
          <ReminderSheet
            visitId={visitId}
            candidate={candidate}
            onClose={() => setOpen(false)}
            onAdded={() => {
              setOpen(false);
              onAdded();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function ReminderSheet({
  visitId,
  candidate,
  onClose,
  onAdded,
}: {
  visitId: string;
  candidate: ReminderCandidate;
  onClose: () => void;
  onAdded: () => void;
}) {
  const today = toDay(new Date());
  const startDay = initialDay(candidate);
  const [day, setDay] = useState(startDay);
  const [saving, setSaving] = useState(false);

  const shift = (days: number) => setDay((d) => clampDay(addDays(d, days), today));
  const away = daysBetween(today, day);

  const confirm = async () => {
    setSaving(true);
    try {
      await addFollowUpToCalendar(visitId, candidate.step, day);
      onAdded();
    } catch (error) {
      setSaving(false);
      if (error instanceof CalendarAccessDenied) {
        Alert.alert(
          'Calendar access needed',
          'Turn on calendar access for Visit Notes in Settings to add follow-ups. The app only adds events; it cannot see your calendar.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ],
        );
      } else {
        Alert.alert(
          'Could not add to Calendar',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };

  return (
    <SafeAreaView style={styles.sheet} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.sheetContent}>
        <Text style={styles.sheetTitle}>Add to Calendar</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Your doctor asked you to</Text>
          <Text style={styles.stepText}>{candidate.step.text}</Text>
        </View>

        <Text style={styles.body}>{suggestionText(candidate)}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Day</Text>
          <Text style={styles.day} accessibilityLiveRegion="polite">
            {dayLabel(day)}
          </Text>
          <Text style={styles.away}>
            {away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : `In ${away} days`}
          </Text>
          <View style={styles.steppers}>
            <Stepper label="−1 week" onPress={() => shift(-7)} disabled={day <= today} />
            <Stepper label="−1 day" onPress={() => shift(-1)} disabled={day <= today} />
            <Stepper label="+1 day" onPress={() => shift(1)} />
            <Stepper label="+1 week" onPress={() => shift(7)} />
          </View>
          {day !== startDay && (
            <Pressable onPress={() => setDay(startDay)} accessibilityRole="button">
              <Text style={styles.link}>
                Back to {candidate.passed ? 'today' : 'the day your doctor said'}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>What goes in your calendar</Text>
          <Text style={styles.body}>
            An all-day event called “{EVENT_TITLE}” on your default calendar. Its note holds only the
            instruction above. Calendar will remind you at 9 AM the day before.
          </Text>
          <Text style={styles.body}>
            Visit Notes can add events but cannot see what is in your calendar.
          </Text>
        </View>

        {candidate.added && (
          <Text style={styles.warning}>
            You already added this for {dayLabel(candidate.added.day)}. Adding it again creates a
            second event; delete the old one in the Calendar app if you no longer need it.
          </Text>
        )}

        <Pressable
          style={[styles.primary, saving && styles.disabled]}
          disabled={saving}
          onPress={() => void confirm()}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Add on {dayLabel(day)}</Text>
          )}
        </Pressable>
        <Pressable style={styles.secondary} disabled={saving} onPress={onClose} accessibilityRole="button">
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stepper({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.stepper, disabled && styles.disabled]}
    >
      <Text style={styles.stepperText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inlineButton: {
    alignSelf: 'flex-start',
    marginLeft: 12,
    marginTop: 4,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1F6FEB',
  },
  inlineButtonDone: { borderColor: '#1A7F37', backgroundColor: 'rgba(26,127,55,0.08)' },
  inlineText: { fontSize: 14, fontWeight: '600', color: '#1F6FEB' },
  inlineTextDone: { color: '#1A7F37' },
  sheet: { flex: 1 },
  sheetContent: { padding: 20, gap: 14 },
  sheetTitle: { fontSize: 22, fontWeight: '700', marginTop: 8 },
  card: { borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)', padding: 16, gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  stepText: { fontSize: 17, lineHeight: 23, color: '#24292F' },
  body: { fontSize: 15, lineHeight: 21, color: '#666' },
  day: { fontSize: 22, fontWeight: '700', color: '#24292F' },
  away: { fontSize: 14, color: '#888' },
  steppers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  stepper: {
    flexGrow: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(31,111,235,0.12)',
  },
  stepperText: { fontSize: 15, fontWeight: '600', color: '#1F6FEB' },
  link: { fontSize: 15, color: '#1F6FEB', marginTop: 4 },
  warning: { fontSize: 14, lineHeight: 19, color: '#9A6700' },
  primary: { backgroundColor: '#1F6FEB', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F6FEB',
  },
  secondaryText: { color: '#1F6FEB', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
