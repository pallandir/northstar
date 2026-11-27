export function createLock(name: string): <T>(task: () => Promise<T>) => Promise<T> {
  return async (task) => navigator.locks.request(name, task);
}
