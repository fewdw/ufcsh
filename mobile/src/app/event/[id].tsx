import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { absolute, useApi, type Corner, type EventDetail, type Fight } from '@/api';
import { Message } from '@/components/message';
import { useTheme, type Palette } from '@/constants/theme';
import { eventDate, rankLabel, SEGMENT_LABEL } from '@/format';

export default function EventScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const theme = useTheme();
  const { data, error, loading, reload } = useApi<EventDetail>(`/api/events/${encodeURIComponent(id)}`);

  // The API sends the card in running order; group consecutive bouts by segment.
  const sections: { title: string; data: Fight[] }[] = [];
  for (const fight of data?.fights ?? []) {
    const title = fight.segment ? SEGMENT_LABEL[fight.segment] : 'Fight card';
    if (sections.at(-1)?.title !== title) sections.push({ title, data: [] });
    sections.at(-1)!.data.push(fight);
  }

  return (
    <>
      <Stack.Screen options={{ title: data?.name ?? name ?? '' }} />
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        keyExtractor={(fight) => fight.id}
        refreshControl={<RefreshControl refreshing={loading && data != null} onRefresh={reload} />}
        ListHeaderComponent={
          data ? (
            <Text style={[styles.header, { color: theme.textSecondary }]}>
              {eventDate(data.date, true)} · {data.location}
            </Text>
          ) : undefined
        }
        ListEmptyComponent={<Message loading={loading} error={error} onRetry={reload} />}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.section, { color: theme.textSecondary, backgroundColor: theme.background }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => <FightRow fight={item} live={data?.live_fight_id === item.id} theme={theme} />}
      />
    </>
  );
}

function FightRow({ fight, live, theme }: { fight: Fight; live: boolean; theme: Palette }) {
  const decided = fight.method != null;
  const middle = decided
    ? [fight.method, fight.round ? `R${fight.round}` : null, fight.time].filter(Boolean).join(' · ')
    : [fight.title_fight ? 'Title' : null, fight.weight_class, fight.scheduled_rounds ? `${fight.scheduled_rounds} rds` : null]
        .filter(Boolean)
        .join(' · ');
  return (
    <View style={[styles.fight, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Fighter corner={fight.f1} odds={fight.odds?.f1?.close} align="left" theme={theme} />
      <View style={styles.middle}>
        {live ? <Text style={styles.live}>LIVE</Text> : null}
        <Text style={[styles.middleText, { color: theme.textSecondary }]} numberOfLines={3}>
          {middle}
        </Text>
      </View>
      <Fighter corner={fight.f2} odds={fight.odds?.f2?.close} align="right" theme={theme} />
    </View>
  );
}

function Fighter({ corner, odds, align, theme }: { corner: Corner; odds?: string | null; align: 'left' | 'right'; theme: Palette }) {
  const lost = corner.outcome === 'loss';
  const textAlign = align;
  return (
    <View style={[styles.fighter, { alignItems: align === 'left' ? 'flex-start' : 'flex-end', opacity: lost ? 0.55 : 1 }]}>
      <Image source={absolute(corner.photo_url)} style={[styles.photo, { backgroundColor: theme.border }]} contentFit="cover" contentPosition="top" transition={150} />
      <Text style={[styles.fighterName, { color: theme.text, textAlign }]} numberOfLines={2}>
        {corner.ranking ? <Text style={{ color: theme.textSecondary }}>{rankLabel(corner.ranking.rank)} </Text> : null}
        {corner.name}
      </Text>
      <Text style={[styles.small, { color: corner.outcome === 'win' ? theme.win : theme.textSecondary, textAlign }]}>
        {corner.outcome === 'win' ? 'Win' : [corner.record, odds].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { fontSize: 13, paddingHorizontal: 20, paddingTop: 4 },
  section: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  fight: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  fighter: { flex: 1, gap: 4 },
  photo: { width: 52, height: 52, borderRadius: 26 },
  fighterName: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 12, fontVariant: ['tabular-nums'] },
  middle: { width: 96, alignItems: 'center', gap: 4 },
  middleText: { fontSize: 12, textAlign: 'center' },
  live: { fontSize: 11, fontWeight: '800', color: '#dc2626' },
});
