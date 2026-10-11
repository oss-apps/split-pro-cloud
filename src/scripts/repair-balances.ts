/**
 * One-off, admin-only balance repair for the hosted app. See the PR description for the design.
 *
 *   pnpm repair:balances                         # dry run (default): audit + plan + report
 *   pnpm repair:balances --apply --confirm <db>  # write the plan, logged to BalanceRepairLog
 *   pnpm repair:balances --undo <runId> --confirm <db>
 *
 * Options: --out <dir> (report directory), --cutoff <ISO time> (override when PR #2 went live).
 * Reads DATABASE_URL. Prints and writes ids and amounts only, never names or emails.
 * Only GroupBalance rows are ever written. Settlements and Balance are reported, never changed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

import { type ApplyOutcome, applySetRepair, undoRun } from './balanceRepair/apply';
import { loadSnapshot } from './balanceRepair/load';
import { buildPlan } from './balanceRepair/plan';
import { parsePairKey } from './balanceRepair/replay';

type Options = {
  apply: boolean;
  undo: string | null;
  out: string | null;
  confirm: string | null;
  cutoff: number | null;
};

const parseArgs = (argv: string[]): Options => {
  const options: Options = { apply: false, undo: null, out: null, confirm: null, cutoff: null };
  const value = (index: number, flag: string) => {
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    return next;
  };
  argv.forEach((arg, index) => {
    if ('--apply' === arg) {
      options.apply = true;
    } else if ('--dry-run' === arg) {
      options.apply = false;
    } else if ('--undo' === arg) {
      options.undo = value(index, arg);
    } else if ('--out' === arg) {
      options.out = value(index, arg);
    } else if ('--confirm' === arg) {
      options.confirm = value(index, arg);
    } else if ('--cutoff' === arg) {
      const cutoff = Date.parse(value(index, arg));
      if (Number.isNaN(cutoff)) {
        throw new Error('--cutoff must be an ISO date');
      }
      options.cutoff = cutoff;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}`);
    }
  });
  if (options.apply && options.undo) {
    throw new Error('Use either --apply or --undo');
  }
  return options;
};

const describeDatabase = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  const parsed = new URL(url);
  return { host: `${parsed.hostname}:${parsed.port || '5432'}`, name: parsed.pathname.slice(1) };
};

const toCsv = (rows: Record<string, string | number | boolean | null>[]) => {
  const [first] = rows;
  if (!first) {
    return '';
  }
  const headers = Object.keys(first);
  const escape = (cell: string | number | boolean | null) => {
    const text = null === cell ? '' : String(cell);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return (
    [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => escape(row[h] ?? null)).join(',')),
    ].join('\n') + '\n'
  );
};

const countBy = <T>(items: T[], getKey: (item: T) => string | string[]) =>
  items.reduce<Record<string, number>>((acc, item) => {
    const keys = getKey(item);
    (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
      acc[key] = (acc[key] ?? 0) + 1;
    });
    return acc;
  }, {});

const seconds = (start: number) => (Date.now() - start) / 1000;

const reasonName = (reason: string) => reason.split(':')[0] ?? reason;

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const database = describeDatabase();
  const mode = options.undo ? 'undo' : options.apply ? 'apply' : 'dry-run';
  const runId = `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outDir = options.out ?? join(tmpdir(), 'opencode', 'repair-reports', runId);

  console.info(`Balance repair (${mode}) on ${database.host}/${database.name}, run ${runId}`);
  if ('dry-run' !== mode && options.confirm !== database.name) {
    throw new Error(
      `Writing requires --confirm ${database.name} (the database name in DATABASE_URL)`,
    );
  }

  const db = new PrismaClient();
  try {
    if ('dry-run' !== mode) {
      const [log] = await db.$queryRaw<{ exists: boolean }[]>`
        SELECT to_regclass('"BalanceRepairLog"') IS NOT NULL AS exists`;
      if (!log?.exists) {
        throw new Error('BalanceRepairLog is missing: run `prisma migrate deploy` first');
      }
    }

    if (options.undo) {
      const started = Date.now();
      const outcomes = await undoRun(db, runId, options.undo);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'undo-results.csv'), toCsv(outcomes));
      console.info(
        `Undo of ${options.undo}: ${JSON.stringify(countBy(outcomes, (o) => o.status))} in ${seconds(started)}s`,
      );
      console.info(`Report: ${outDir}`);
      return;
    }

    const started = Date.now();
    const snapshot = await loadSnapshot(db);
    if (null !== options.cutoff) {
      snapshot.cutoff = options.cutoff;
    }
    const loaded = Date.now();
    const plan = buildPlan(snapshot, snapshot.expenseAmounts);
    const planned = Date.now();

    const repairSets = plan.analyses.filter((a) => 'repair' === a.verdict);
    const changes = repairSets.flatMap((a) => a.changes);
    const wouldChangeSets = plan.analyses.filter((a) => a.wouldChange.length);
    const rawByRow = new Map(plan.groupMismatches.map((m) => [`${m.key}#${m.groupId}`, m.raw]));
    const verdictBySet = new Map(plan.analyses.map((a) => [a.setId, a.verdict]));
    const verdictOfKey = (key: string) => verdictBySet.get(plan.setOf.get(key) ?? '') ?? 'unknown';

    // Rows are counted on both mirrored sides, matching a plain query over "GroupBalance".
    const summary: Record<string, unknown> = {
      runId,
      mode,
      database: database.name,
      snapshotAt: snapshot.loadedAt.toISOString(),
      pr2Cutoff: Number.isFinite(snapshot.cutoff) ? new Date(snapshot.cutoff).toISOString() : null,
      timings: { loadSeconds: (loaded - started) / 1000, planSeconds: (planned - loaded) / 1000 },
      audit: {
        mirrorBreaks: plan.mirror,
        balanceDriftPairs: plan.balanceDrift.length,
        balanceDriftImportedPairs: plan.balanceDrift.filter((d) => d.imported).length,
        balanceDriftMissingRows: plan.balanceDrift.filter((d) => d.missing).length,
        groupBalanceRowsOffRawSum: plan.groupMismatches.length * 2,
        groupBalanceRowsZeroed: plan.groupMismatches.filter((m) => 'zeroed' === m.kind).length * 2,
        groupBalanceRowsOther: plan.groupMismatches.filter((m) => 'other' === m.kind).length * 2,
        groupsOffRawSum: new Set(plan.groupMismatches.map((m) => m.groupId)).size,
      },
      settlementsReportOnly: {
        nonCanonical: plan.settlementFindings.length,
        byReason: countBy(plan.settlementFindings, (f) => f.reason),
        withLaterActivity: plan.settlementFindings.filter(
          (f) => f.laterExpenses + f.laterSettlements > 0,
        ).length,
        withDeletedSettlements: plan.settlementFindings.filter((f) => f.deletedSettlements > 0)
          .length,
      },
      groupRepair: {
        sets: plan.analyses.length,
        byVerdict: countBy(plan.analyses, (a) => a.verdict),
        setsTheCorrectedRuleWouldChange: wouldChangeSets.length,
        rowsTheCorrectedRuleWouldChange: wouldChangeSets.reduce(
          (n, a) => n + a.wouldChange.length * 2,
          0,
        ),
        // A set can have several reasons, so these overlap.
        skipReasonsBySets: countBy(
          wouldChangeSets.filter((a) => 'skipped' === a.verdict),
          (a) => a.reasons.map(reasonName),
        ),
        skipReasonsByRows: wouldChangeSets
          .filter((a) => 'skipped' === a.verdict)
          .reduce<Record<string, number>>((acc, a) => {
            a.reasons.map(reasonName).forEach((r) => {
              acc[r] = (acc[r] ?? 0) + a.wouldChange.length * 2;
            });
            return acc;
          }, {}),
        notReproducedReasons: countBy(
          plan.analyses.filter((a) => 'not-reproduced' === a.verdict),
          (a) => a.reasons.map(reasonName).join('+'),
        ),
        offRawRowsByVerdict: Object.fromEntries(
          Object.entries(countBy(plan.groupMismatches, (m) => verdictOfKey(m.key))).map(
            ([verdict, count]) => [verdict, count * 2],
          ),
        ),
        repairSets: repairSets.length,
        repairRows: changes.length * 2,
        repairRowsThatEndAtRawSum:
          changes.filter((c) => (rawByRow.get(`${c.key}#${c.groupId}`) ?? c.stored) === c.corrected)
            .length * 2,
        repairGroups: new Set(changes.map((c) => c.groupId)).size,
        balanceRowsTouched: 0,
      },
    };

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'settlements.csv'), toCsv(plan.settlementFindings));
    writeFileSync(
      join(outDir, 'sets.csv'),
      toCsv(
        plan.analyses
          .filter((a) => a.wouldChange.length || 'not-reproduced' === a.verdict)
          .map((a) => ({
            setId: a.setId,
            currency: a.currency,
            pairs: a.pairCount,
            groups: a.groupIds.join(' '),
            verdict: a.verdict,
            reproducesLegacy: a.reproducesLegacy,
            rowsTheCorrectedRuleWouldChange: a.wouldChange.length * 2,
            rowsToChange: a.changes.length * 2,
            reasons: a.reasons.join(' '),
          })),
      ),
    );
    writeFileSync(
      join(outDir, 'group-changes.csv'),
      toCsv(
        plan.analyses
          .filter((a) => a.wouldChange.length)
          .flatMap((a) =>
            a.wouldChange.map((c) => {
              const { currency, lo, hi } = parsePairKey(c.key);
              return {
                setId: a.setId,
                verdict: verdictBySet.get(a.setId) ?? '',
                groupId: c.groupId,
                currency,
                userId: lo,
                friendId: hi,
                stored: c.stored,
                corrected: c.corrected,
                delta: c.corrected - c.stored,
              };
            }),
          ),
      ),
    );

    if (options.apply) {
      const applyStarted = Date.now();
      const outcomes: ApplyOutcome[] = [];
      for (const analysis of repairSets) {
        const keys = plan.sets.get(analysis.setId) ?? [];
        outcomes.push(
          await applySetRepair(db, runId, snapshot.loadedAt, {
            setId: analysis.setId,
            keys,
            rows: plan.directedRows(keys),
            changes: analysis.changes,
            expenseIds: plan.expenseIdsBySet.get(analysis.setId) ?? [],
          }),
        );
      }
      writeFileSync(join(outDir, 'apply-results.csv'), toCsv(outcomes));
      summary.apply = {
        seconds: seconds(applyStarted),
        byStatus: countBy(outcomes, (o) => o.status),
        rowsWritten: outcomes.reduce((sum, o) => sum + o.rows, 0),
      };
    }

    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.info(JSON.stringify(summary, null, 2));
    console.info(`Report: ${outDir}`);
    if (options.apply) {
      console.info(`Undo with: pnpm repair:balances --undo ${runId} --confirm ${database.name}`);
    }
  } finally {
    await db.$disconnect();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
