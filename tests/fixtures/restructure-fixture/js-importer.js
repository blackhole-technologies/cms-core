// Plain JS file that imports the TS fixture module. Used to verify the codemod
// loads .js files into the ts-morph project (allowJs) and rewrites their
// imports when the .ts target moves.
import { fooValue } from './foo.ts';

export const jsValue = fooValue + 100;
