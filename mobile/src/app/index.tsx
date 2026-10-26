import { Link } from 'expo-router';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { useApi, type EventSummary } from '@/api';
import { Message } from '@/components/message';
import { useTheme } from '@/constants/theme';
import { eventDate } from '@/format';

export default function EventsScreen() {
  const theme = useTheme();
  const { data, error, loading, reload } = useApi<EventSummary[]>('/api/events');
  const events = (data ?? []).filter((event) => !event.potential);
  const sections = [
    // The API lists newest first; upcoming reads soonest first.
    { title: 'Upcoming', data: events.filter((event) => event.status !== 'past').reverse() },
    { title: 'Results', data: events.filter((event) => event.status === 'past') },
  ].filter((section) => section.data.length > 0);

  return (
    <SectionList
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(event) => event.id}
      refreshControl={<RefreshControl refreshing={loading && data != null} onRefresh={reload} />}
      ListEmptyComponent={<Message loading={loading} error={error} onRetry={reload} />}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.section, { color: theme.textSecondary, backgroundColor: theme.background }]}>
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <Link href={{ pathname: '/event/[id]', params: { id: item.id, name: item.name } }} asChild>
          <Pressable style={({ pressed }) => [styles.row, { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}>
            <View style={styles.rowText}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.meta, { color: theme.textSecondary }]} numberOfLines={1}>
                {eventDate(item.date, item.status === 'past')} · {item.location}
              </Text>
            </View>
            {item.status === 'next' ? <Text style={styles.next}>NEXT</Text> : null}
          </Pressable>
        </Link>
      )}
    />
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13 },
  next: { fontSize: 11, fontWeight: '700', color: '#f59e0b', marginLeft: 12 },
});
