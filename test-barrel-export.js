import { AccessResult, combineAccessResults, AccessPolicy } from './core/lib/Access/index.js';

const result = AccessResult.allowed();
const combined = combineAccessResults([result]);
const policy = new AccessPolicy();

console.log('Barrel export test:');
console.log('AccessResult works:', result.isAllowed());
console.log('combineAccessResults works:', combined.isAllowed());
console.log('AccessPolicy works:', policy instanceof AccessPolicy);
