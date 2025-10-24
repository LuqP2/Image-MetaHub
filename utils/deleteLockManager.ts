// Global lock manager for delete operations to prevent double confirmations
class DeleteLockManager {
  private static instance: DeleteLockManager;
  private locked = false;

  private constructor() {}

  static getInstance(): DeleteLockManager {
    if (!DeleteLockManager.instance) {
      DeleteLockManager.instance = new DeleteLockManager();
    }
    return DeleteLockManager.instance;
  }

  isLocked(): boolean {
    return this.locked;
  }

  lock(): void {
    this.locked = true;
    setTimeout(() => {
      this.locked = false;
    }, 1000);
  }
}

export const deleteLockManager = DeleteLockManager.getInstance();