import { z } from 'zod';

export const Framework = {
  PLAYWRIGHT: 'PLAYWRIGHT',
  SELENIUM: 'SELENIUM',
  SELENIUM_JAVA: 'SELENIUM_JAVA',
  CYPRESS: 'CYPRESS',
} as const;

export type Framework = (typeof Framework)[keyof typeof Framework];

export const frameworkSchema = z.enum([
  'PLAYWRIGHT',
  'SELENIUM',
  'SELENIUM_JAVA',
  'CYPRESS',
]);
