import { useMemo } from 'react';
import { createBoardPresentation } from '../services/boards/presentation';
import { useTranslation } from './useTranslation';

export function useBoardPresentation() {
  const { t, language } = useTranslation();
  return useMemo(() => createBoardPresentation(t, language), [t, language]);
}
