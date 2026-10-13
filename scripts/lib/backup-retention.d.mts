export const BACKUP_NAME: RegExp;
export const DEFAULT_POLICY: { daily: number; weekly: number; monthly: number };
export function planRetention(names: string[], policy?: { daily: number; weekly: number; monthly: number }): { keep: string[]; delete: string[] };
