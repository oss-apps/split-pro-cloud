---
title: How "simplify debts" works, explained with an example
description: Why a group can settle up in far fewer payments than there were expenses, how the calculation works step by step, and its one trade-off.
date: 2026-10-10
author: KM Koushik
tags: How it works
---

After a trip, you'd expect the number of payments to grow with the number of expenses. Six friends, thirty expenses: that's a lot of transfers. In practice, any group can settle up in **at most one payment fewer than the number of people**, however many expenses there were. Four people never need more than three payments.

Apps call this "simplify debts" or "minimize payments". Here is how it works.

## Step 1: Forget the individual expenses

The trick is to stop thinking about _who paid for what_, and look only at where each person ended up.

For each person, add up:

- **Paid**: everything they paid for.
- **Share**: their part of every expense they were in.

Their **balance** is paid minus share. Positive means the group owes them money. Negative means they owe the group.

Take a weekend trip with four friends:

- Alex paid **$480** for the cabin, split four ways.
- Priya paid **$126.40** for groceries, split four ways.
- Jordan paid **$72** for gas, split between Alex, Jordan and Sam (Priya traveled separately).
- Sam paid **$186** for Saturday dinner, split four ways.

|        | Paid    | Share   | Balance      |
| ------ | ------- | ------- | ------------ |
| Alex   | $480.00 | $222.10 | **+$257.90** |
| Priya  | $126.40 | $198.10 | **−$71.70**  |
| Jordan | $72.00  | $222.10 | **−$150.10** |
| Sam    | $186.00 | $222.10 | **−$36.10**  |

The balances always add up to zero: every dollar someone is owed, someone else owes.

## Step 2: Match debtors with creditors

Now ignore the expenses entirely. We only need payments that bring every balance to zero. A simple method that works well:

1. Take the person who **owes the most** and the person who **is owed the most**.
2. The debtor pays the creditor the smaller of the two amounts. At least one of them is now settled.
3. Repeat until everyone is at zero.

In the example, Alex is owed $257.90 and Jordan owes the most, $150.10:

1. **Jordan pays Alex $150.10.** Jordan is done. Alex is still owed $107.80.
2. **Priya pays Alex $71.70.** Priya is done. Alex is still owed $36.10.
3. **Sam pays Alex $36.10.** Everyone is done.

Three payments. Paying back every expense directly would take 11 transfers for the same result, because almost everyone owes almost everyone else a little.

## Why it never takes more than n − 1 payments

Every payment in step 2 settles at least one person completely. With four people, after three payments at most one person can be left, and since the balances add up to zero, their balance must be zero too. So the group never needs more than three payments. For six people, never more than five.

## The trade-off: you might pay someone you didn't owe

Simplifying can create payments between people who never had an expense together. If Priya owed Sam for a coffee and Sam owed Alex for the cabin, the simplified result might have Priya pay Alex directly and leave Sam out.

The totals are identical and nobody pays a cent more. But it can feel strange to send money to someone who never paid for anything you had. That's why it helps to explain the idea to your group once, or to share the full balance table along with the payments.

## Is this the smallest possible number of payments?

Usually, but not always. Finding the true minimum in every case is a famously hard problem in computer science: it means searching for groups of people whose balances cancel out exactly, and the number of combinations explodes as the group grows. The greedy method above is fast, easy to check by hand, and in everyday groups it almost always gives the minimum or comes within one payment of it.

## Try it with your own numbers

Our free [quick split](/split) does exactly this. Add the people and the expenses, untick anyone who wasn't part of something, and it shows the balances and the payments. It runs in your browser, and you can share it with a link.

For trips that are still going on, or for a group you split with every week, [SplitPro](/auth/signin) keeps a running balance for everyone, so settling up is just a matter of looking at the numbers.
