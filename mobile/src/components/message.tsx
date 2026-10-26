import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/constants/theme';

/** What a list shows before it has rows: a spinner, or the error and a retry. */
export function Message({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  const theme = useTheme();
  if (loading) return <ActivityIndicator style={styles.box} />;
  return (
    <View style={styles.box}>
      <Text style={{ color: theme.textSecondary }}>{error ? `Couldn't load (${error}).` : 'Nothing here yet.'}</Text>
      {error ? (
        <Pressable onPress={onRetry} hitSlop={12}>
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 32, alignItems: 'center', gap: 12 },
  retry: { color: '#f59e0b', fontWeight: '600' },
});
