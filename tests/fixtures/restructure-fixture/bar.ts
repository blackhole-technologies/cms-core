import { fooFn, fooValue } from './foo.ts';

export const barValue = fooValue + 1;
export function barFn(): number {
  return fooFn() + 1;
}
