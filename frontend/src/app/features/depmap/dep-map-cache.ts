export const DEP_MAP_CACHE_KEY = 'depmap-cache-v2';

export function clearDepMapCache(): void {
  try { localStorage.removeItem(DEP_MAP_CACHE_KEY); } catch { /* localStorage can be disabled */ }
}
