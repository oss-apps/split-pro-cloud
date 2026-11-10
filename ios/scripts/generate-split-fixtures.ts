import { writeFileSync, mkdirSync } from 'node:fs';
import { SplitType } from '@prisma/client';
import {
  calculateParticipantSplit,
  calculateSplitShareBasedOnAmount,
  type Participant,
} from '../../src/store/addStore';
import { toInteger } from '../../src/utils/numbers';

// Execute the production implementation, not a second implementation of the algorithm.
const fixtures = Object.values(SplitType)
  .filter((kind) => kind !== 'SETTLEMENT')
  .flatMap((kind) =>
    [3, 4, 5, 6, 7, 3].map((count, scenario) => {
      const cents = [10001, 7793, 1, 12345, 99999, -10001][scenario]!;
      const participants = Array.from({ length: count }, (_, index) => {
        let splitShare = 1;
        if (kind === 'PERCENTAGE') {
          splitShare = (Math.floor(10000 / count) + (index === 0 ? 10000 % count : 0)) / 100;
        } else if (kind === 'SHARE') splitShare = index + 1;
        else if (kind === 'EXACT') {
          splitShare =
            (Math.floor(Math.abs(cents) / count) + (index === 0 ? Math.abs(cents) % count : 0)) /
            100;
        } else if (kind === 'ADJUSTMENT') splitShare = scenario === 2 ? 0 : index / 100;
        return { id: (count - index) * 7, splitShare } as Participant;
      });
      const payer = participants[scenario % count]!;
      const result = calculateParticipantSplit(cents / 100, participants, kind, payer);
      return {
        name: `${kind}-${count}-${scenario}`,
        cents,
        kind,
        payer: payer.id,
        people: participants.map((p) => ({ id: p.id, share: String(p.splitShare) })),
        expected: result.participants.map((p) => toInteger(p.amount ?? 0)),
        valid: result.canSplitScreenClosed,
        switches: Object.values(SplitType)
          .filter((target) => target !== 'SETTLEMENT')
          .map((target) => {
            const rebuilt = calculateSplitShareBasedOnAmount(
              cents / 100,
              result.participants,
              target,
              payer,
            );
            const recalculated = calculateParticipantSplit(cents / 100, rebuilt, target, payer);
            return {
              kind: target,
              expected: recalculated.participants.map((p) => toInteger(p.amount ?? 0)),
              valid: recalculated.canSplitScreenClosed,
            };
          }),
      };
    }),
  );
mkdirSync('ios/SplitProTests/Fixtures', { recursive: true });
writeFileSync('ios/SplitProTests/Fixtures/splits.json', JSON.stringify(fixtures, null, 2) + '\n');
console.info(`Generated ${fixtures.length} fixtures from src/store/addStore.ts`);
