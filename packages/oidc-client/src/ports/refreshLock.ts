export interface RefreshLock {
  runExclusive<T>(
    ownerNamespace: string,
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
  close?(): Promise<void> | void;
}
