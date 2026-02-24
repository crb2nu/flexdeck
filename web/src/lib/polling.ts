type PollingTask = () => Promise<void> | void;

interface TaskEntry {
  task: PollingTask;
  interval: number;
  timer?: any;
}

class PollingScheduler {
  private tasks: Map<string, TaskEntry> = new Map();
  private isPaused = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.pause();
        } else {
          this.resume();
        }
      });
    }
  }

  /**
   * Register a new polling task.
   * If a task with the same ID already exists, it will be replaced.
   */
  register(id: string, task: PollingTask, interval: number, immediate = true) {
    this.unregister(id);

    const entry: TaskEntry = { task, interval };
    this.tasks.set(id, entry);

    if (!this.isPaused) {
      this.startTask(id, entry);
      if (immediate) {
        this.runTask(id, entry);
      }
    }
  }

  /**
   * Remove a polling task by ID.
   */
  unregister(id: string) {
    const entry = this.tasks.get(id);
    if (entry) {
      if (entry.timer) {
        clearInterval(entry.timer);
      }
      this.tasks.delete(id);
    }
  }

  /**
   * Manually trigger a task by ID.
   */
  trigger(id: string) {
    const entry = this.tasks.get(id);
    if (entry) {
      this.runTask(id, entry);
    }
  }

  private startTask(id: string, entry: TaskEntry) {
    if (entry.timer) {
      clearInterval(entry.timer);
    }
    entry.timer = setInterval(() => this.runTask(id, entry), entry.interval);
  }

  private async runTask(id: string, entry: TaskEntry) {
    if (this.isPaused) return;
    try {
      await entry.task();
    } catch (error) {
      console.error(`Polling task "${id}" failed:`, error);
    }
  }

  private pause() {
    this.isPaused = true;
    for (const entry of this.tasks.values()) {
      if (entry.timer) {
        clearInterval(entry.timer);
        entry.timer = undefined;
      }
    }
  }

  private resume() {
    this.isPaused = false;
    for (const [id, entry] of this.tasks.entries()) {
      this.startTask(id, entry);
      // Run immediately on resume to refresh stale data
      this.runTask(id, entry);
    }
  }
}

export const pollingScheduler = new PollingScheduler();
