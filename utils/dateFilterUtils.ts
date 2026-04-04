const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseLocalDateParts = (value: string): [number, number, number] | null => {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
};

export const formatLocalDateKey = (value: number | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const parseLocalDateFilterStart = (value: string): number => {
  const parts = parseLocalDateParts(value);
  if (!parts) {
    return new Date(value).getTime();
  }

  const [year, month, day] = parts;
  return new Date(year, month, day).getTime();
};

export const parseLocalDateFilterEndExclusive = (value: string): number => {
  const parts = parseLocalDateParts(value);
  if (!parts) {
    const date = new Date(value);
    date.setDate(date.getDate() + 1);
    return date.getTime();
  }

  const [year, month, day] = parts;
  return new Date(year, month, day + 1).getTime();
};
