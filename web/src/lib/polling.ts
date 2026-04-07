type PollingTask = () => Promise<void> | void;

interface TaskEntry {
  task: PollingTask;
  baseInterval: number; // original interval for jitter calculations
  interval: number;     // current jittered interval
  allowImmediate: boolean;
  timer?: any;
  immediateTimer?: any;
  running?: boolean;
}

/** Stagger delay: index * step + random(0..jitter) */
function staggerDelay(index: number, step: number, jitter: number): number {
  return index * step + Math.random() * jitter;
}

/** Apply ±10% jitter to a base interval */
function jitteredInterval(base: number): number {
  const factor = 0.9 + Math.random() * 0.2; // [0.9, 1.1)
  return Math.round(base * factor);
}

class PollingScheduler {
  private tasks: Map<string, TaskEntry> = new Map();
  private isPaused = false;
  private registrationIndex = 0;

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
   * Immediate fires are staggered by registration order to avoid burst requests.
   */
  register(id: string, task: PollingTask, interval: number, immediate = true) {
    this.unregister(id);

    const entry: TaskEntry = {
      task,
      baseInterval: interval,
      interval: jitteredInterval(interval),
      allowImmediate: immediate,
    };
    this.tasks.set(id, entry);

    if (!this.isPaused) {
      this.startTask(id, entry);
      if (entry.allowImmediate) {
        const idx = this.registrationIndex++;
        const delay = staggerDelay(idx, 20, 50);
        entry.immediateTimer = setTimeout(() => {
          entry.immediateTimer = undefined;
          if (this.tasks.has(id) && !this.isPaused) {
            this.runTask(id, entry);
          }
        }, delay);
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
      if (entry.immediateTimer) {
        clearTimeout(entry.immediateTimer);
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
    // Apply fresh jitter each time the interval restarts
    entry.interval = jitteredInterval(entry.baseInterval);
    entry.timer = setInterval(() => this.runTask(id, entry), entry.interval);
  }

  private async runTask(id: string, entry: TaskEntry) {
    if (this.isPaused || entry.running) return;
    entry.running = true;
    try {
      await entry.task();
    } catch (error) {
      console.error(`Polling task "${id}" failed:`, error);
    } finally {
      entry.running = false;
    }
  }

  private pause() {
    this.isPaused = true;
    for (const entry of this.tasks.values()) {
      if (entry.timer) {
        clearInterval(entry.timer);
        entry.timer = undefined;
      }
      if (entry.immediateTimer) {
        clearTimeout(entry.immediateTimer);
        entry.immediateTimer = undefined;
      }
    }
  }

  private resume() {
    this.isPaused = false;
    let idx = 0;
    for (const [id, entry] of this.tasks.entries()) {
      this.startTask(id, entry);
      if (entry.allowImmediate) {
        // Stagger resume fires to avoid burst.
        const delay = staggerDelay(idx++, 30, 50);
        entry.immediateTimer = setTimeout(() => {
          entry.immediateTimer = undefined;
          if (this.tasks.has(id) && !this.isPaused) {
            this.runTask(id, entry);
          }
        }, delay);
      }
    }
  }
}

export const pollingScheduler = new PollingScheduler();
