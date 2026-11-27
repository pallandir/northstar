export function createLock(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    // The chain must outlive a failed task; the caller still receives the rejection through `run`.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
