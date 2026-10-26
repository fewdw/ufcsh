// Event dates are calendar days ("2026-10-31"); read them in UTC so no time
// zone moves a card to the day before.
export function eventDate(date: string, withYear = false) {
  if (!date) return '';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export const SEGMENT_LABEL = { main: 'Main card', prelims: 'Prelims', early: 'Early prelims' } as const;

// Same badge as the site: champion, interim champion, or the ranked place.
export const rankLabel = (rank: string) => (rank === 'C' || rank === 'IC' ? rank : `#${rank}`);
