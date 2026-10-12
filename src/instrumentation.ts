/**
 * Add things here to be executed during server startup.
 *
 * more details here: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('Registering instrumentation');
    const { validateAuthEnv } = await import('./server/auth');
    validateAuthEnv();

    const { env } = await import('./env');
    if (!env.RECURRING_RUNNER_DISABLED && 'phase-production-build' !== process.env.NEXT_PHASE) {
      const { startRecurringRunner } = await import('./server/api/services/recurringRunner');
      startRecurringRunner(
        env.RECURRING_RUNNER_INTERVAL_SECONDS
          ? env.RECURRING_RUNNER_INTERVAL_SECONDS * 1000
          : undefined,
      );
    }
  }
}
