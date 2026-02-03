// Scheduler for timed device actions

export interface ScheduledJob {
  id: string;
  timedDeviceId: string;
  timedDeviceName: string;
  action: 'turn_on' | 'turn_off';
  scheduledAt: number;       // When the job was scheduled
  executeAt: number;         // When to execute
  targetDevices: Array<{
    pluginId: string;
    externalDeviceId: string;
    deviceName: string;
  }>;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  completedAt?: number;
}

export type ActionExecutor = (
  pluginId: string,
  externalDeviceId: string,
  newState: boolean
) => Promise<{ success: boolean; error?: string }>;

class Scheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private jobCounter: number = 0;
  private actionExecutor: ActionExecutor | null = null;

  setActionExecutor(executor: ActionExecutor): void {
    this.actionExecutor = executor;
  }

  scheduleJob(
    timedDeviceId: string,
    timedDeviceName: string,
    action: 'turn_on' | 'turn_off',
    delayMs: number,
    targetDevices: ScheduledJob['targetDevices']
  ): ScheduledJob {
    const id = `job_${++this.jobCounter}_${Date.now()}`;
    const now = Date.now();

    const job: ScheduledJob = {
      id,
      timedDeviceId,
      timedDeviceName,
      action,
      scheduledAt: now,
      executeAt: now + delayMs,
      targetDevices,
      status: 'pending'
    };

    this.jobs.set(id, job);

    // Schedule the execution
    const timer = setTimeout(() => this.executeJob(id), delayMs);
    this.timers.set(id, timer);

    console.log(`[TimedDevices] Scheduled job ${id}: ${action} in ${Math.round(delayMs / 1000)}s for ${targetDevices.length} device(s)`);

    return job;
  }

  private async executeJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    if (job.status === 'cancelled') {
      this.cleanup(jobId);
      return;
    }

    job.status = 'executing';
    console.log(`[TimedDevices] Executing job ${jobId}: ${job.action} on ${job.targetDevices.length} device(s)`);

    if (!this.actionExecutor) {
      job.status = 'failed';
      job.error = 'No action executor configured';
      job.completedAt = Date.now();
      return;
    }

    const newState = job.action === 'turn_on';
    const errors: string[] = [];

    for (const device of job.targetDevices) {
      try {
        const result = await this.actionExecutor(device.pluginId, device.externalDeviceId, newState);
        if (!result.success) {
          errors.push(`${device.deviceName}: ${result.error || 'Unknown error'}`);
        }
      } catch (err: any) {
        errors.push(`${device.deviceName}: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      job.status = 'failed';
      job.error = errors.join('; ');
    } else {
      job.status = 'completed';
    }
    job.completedAt = Date.now();

    console.log(`[TimedDevices] Job ${jobId} ${job.status}${job.error ? ': ' + job.error : ''}`);

    // Keep completed jobs for a while for status display
    setTimeout(() => this.cleanup(jobId), 60000);
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'pending') {
      return false;
    }

    job.status = 'cancelled';
    job.completedAt = Date.now();

    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }

    console.log(`[TimedDevices] Cancelled job ${jobId}`);
    return true;
  }

  cancelJobsForTimedDevice(timedDeviceId: string): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.timedDeviceId === timedDeviceId && job.status === 'pending') {
        this.cancelJob(job.id);
        count++;
      }
    }
    return count;
  }

  private cleanup(jobId: string): void {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }
    this.jobs.delete(jobId);
  }

  getJob(jobId: string): ScheduledJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  getActiveJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values()).filter(j =>
      j.status === 'pending' || j.status === 'executing'
    );
  }

  getJobsForTimedDevice(timedDeviceId: string): ScheduledJob[] {
    return Array.from(this.jobs.values()).filter(j => j.timedDeviceId === timedDeviceId);
  }

  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.jobs.clear();
    this.jobCounter = 0;
    console.log('[TimedDevices] Scheduler shutdown');
  }
}

// Singleton instance
export const scheduler = new Scheduler();
