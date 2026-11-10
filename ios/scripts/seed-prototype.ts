import { PrismaClient } from '@prisma/client';
import { calculateParticipantSplit, type Participant } from '../../src/store/addStore';
import { toInteger } from '../../src/utils/numbers';

const db = new PrismaClient();
const main = async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '55452' ||
    url.pathname !== '/spswift'
  ) {
    throw new Error('This seed only runs against the disposable Swift prototype database.');
  }
  const names = [
    'Alex Morgan',
    'Priya Sharma',
    'Jamie Chen',
    'Sam Wilson',
    'Maya Patel',
    'Oliver Brooks',
    'Sofia Rivera',
    'Noah Kim',
    'Isabella Rossi',
    'Liam Taylor',
    'Amelia Lewis',
    'Ethan Park',
  ];
  const people = await Promise.all(
    names.map((name, index) =>
      db.user.upsert({
        where: { email: index === 0 ? 'alex@example.test' : `friend${index}@example.test` },
        create: {
          name,
          email: index === 0 ? 'alex@example.test' : `friend${index}@example.test`,
          emailVerified: new Date(),
        },
        update: { name },
      }),
    ),
  );
  const me = people[0]!;
  await db.friendship.createMany({
    data: people.slice(1).flatMap((friend) => [
      { userId: me.id, friendId: friend.id },
      { userId: friend.id, friendId: me.id },
    ]),
    skipDuplicates: true,
  });
  const groups = await Promise.all(
    ['Apartment 4B', 'Goa trip', 'Weekend crew'].map((name, index) =>
      db.group.upsert({
        where: { publicId: `swift-prototype-${index}` },
        create: {
          publicId: `swift-prototype-${index}`,
          name,
          userId: me.id,
          defaultCurrency: index === 1 ? 'INR' : 'USD',
          groupUsers: { create: people.slice(0, 4).map((p) => ({ userId: p.id })) },
        },
        update: {},
      }),
    ),
  );
  const labels = [
    'Rent',
    'Groceries',
    'Goa trip dinner',
    'Coffee run',
    'Train tickets',
    'Sunday brunch',
    'Movie night',
    'Farmers market',
    'Airport taxi',
    'Beach lunch',
    'House supplies',
    'Museum tickets',
    'Pizza night',
    'Fuel',
    'Dinner by the water',
  ];
  for (const [index, name] of labels.entries()) {
    const friend = people[1 + (index % (people.length - 1))]!;
    const payer = index % 3 === 0 ? friend : me;
    const currency = index === 2 || index === 9 ? 'INR' : index === 11 ? 'EUR' : 'USD';
    const cents = [
      240000, 8657, 640000, 1850, 12600, 8499, 4200, 6753, 5880, 320000, 3895, 6800, 5697, 7300,
      11299,
    ][index]!;
    const result = calculateParticipantSplit(
      cents / 100,
      [me, friend].map((p) => ({ ...p, splitShare: 1 })) as Participant[],
      'EQUAL',
      payer,
    );
    const id = `swift-prototype-expense-${index}`;
    await db.groupUser.createMany({
      data: [me, friend].map((p) => ({ groupId: groups[index % 3]!.id, userId: p.id })),
      skipDuplicates: true,
    });
    if (await db.expense.findUnique({ where: { id } })) continue;
    await db.$transaction(async (tx) => {
      await tx.expense.create({
        data: {
          id,
          name,
          amount: cents,
          paidBy: payer.id,
          addedBy: me.id,
          category: 'general',
          currency,
          groupId: groups[index % 3]!.id,
          expenseDate: new Date(Date.now() - index * 86400000),
          expenseParticipants: {
            create: result.participants.map((p) => ({
              userId: p.id,
              amount: toInteger(p.amount!),
            })),
          },
        },
      });
      const other = payer.id === me.id ? friend : me;
      const otherAmount = toInteger(result.participants.find((p) => p.id === other.id)!.amount!);
      for (const row of [
        { userId: payer.id, friendId: other.id, amount: -otherAmount },
        { userId: other.id, friendId: payer.id, amount: otherAmount },
      ]) {
        await tx.balance.upsert({
          where: {
            userId_currency_friendId: { userId: row.userId, currency, friendId: row.friendId },
          },
          create: { ...row, currency },
          update: { amount: { increment: row.amount } },
        });
        await tx.groupBalance.upsert({
          where: {
            groupId_currency_firendId_userId: {
              groupId: groups[index % 3]!.id,
              currency,
              userId: row.userId,
              firendId: row.friendId,
            },
          },
          create: {
            groupId: groups[index % 3]!.id,
            currency,
            userId: row.userId,
            firendId: row.friendId,
            amount: row.amount,
          },
          update: { amount: { increment: row.amount } },
        });
      }
    });
  }
  console.info('Seeded fictional users, 3 groups, and 15 expenses. Sign in as alex@example.test.');
};
main().finally(() => db.$disconnect());
