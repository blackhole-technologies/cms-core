/**
 * Declaration file for locks.js
 * Provides type information for the content locking system
 */

export interface LockInfo {
  type: string;
  id: string;
  userId: string;
  username: string;
  acquiredAt: string;
  expiresAt: string;
  lastActivity: string;
}

export interface LockConfig {
  enabled?: boolean;
  timeout?: number;
  gracePeriod?: number;
  contentDir?: string;
}

/** Result from checkLock — shape varies by lock state */
export interface LockStatus {
  locked: boolean;
  enabled?: boolean;
  wasExpired?: boolean;
  inGracePeriod?: boolean;
  userId?: string;
  username?: string;
  acquiredAt?: string;
  expiresAt?: string;
  graceEndsAt?: string;
  lastActivity?: string;
  expiresIn?: number;
}

/** Result from checkUpdateAllowed — null means allowed, object means locked */
export interface LockError {
  error: string;
  message: string;
  lockedBy: string;
  lockedByUserId: string;
  expiresIn: number;
  expiresAt: string;
  inGracePeriod: boolean;
}

export function init(config?: LockConfig): void;
export function initDb(pool: unknown): Promise<void>;
export function acquireLock(type: string, id: string, userId: string, options?: Record<string, unknown>): LockInfo | null;
export function releaseLock(type: string, id: string, userId: string): boolean;
export function checkLock(type: string, id: string): LockStatus;
export function refreshLock(type: string, id: string, userId: string): LockInfo | null;
export function forceRelease(type: string, id: string): boolean;
export function listLocks(type?: string | null): LockInfo[];
export function cleanupExpired(): number;
export function checkUpdateAllowed(type: string, id: string, userId: string): LockError | null;
export function getStats(): Record<string, unknown>;
export function getConfig(): Record<string, unknown>;
export function formatDuration(seconds: number): string;

declare const _default: {
  init: typeof init;
  initDb: typeof initDb;
  acquireLock: typeof acquireLock;
  releaseLock: typeof releaseLock;
  checkLock: typeof checkLock;
  refreshLock: typeof refreshLock;
  forceRelease: typeof forceRelease;
  listLocks: typeof listLocks;
  cleanupExpired: typeof cleanupExpired;
  checkUpdateAllowed: typeof checkUpdateAllowed;
  getStats: typeof getStats;
  getConfig: typeof getConfig;
  formatDuration: typeof formatDuration;
};
export default _default;
