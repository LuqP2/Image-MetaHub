import { describe, expect, it } from 'vitest';
import { formatLocalDateKey, parseLocalDateFilterEndExclusive, parseLocalDateFilterStart } from '../utils/dateFilterUtils';

describe('dateFilterUtils', () => {
  it('formats and parses local date keys without switching to UTC boundaries', () => {
    const localEvening = new Date(2026, 3, 3, 22, 0, 0, 0);

    expect(formatLocalDateKey(localEvening)).toBe('2026-04-03');
    expect(parseLocalDateFilterStart('2026-04-03')).toBe(new Date(2026, 3, 3).getTime());
    expect(parseLocalDateFilterEndExclusive('2026-04-03')).toBe(new Date(2026, 3, 4).getTime());
  });
});
