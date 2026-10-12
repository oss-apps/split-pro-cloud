---
title: How to move from Splitwise to SplitPro
description: A step-by-step guide to bringing your friends, groups and full expense history from Splitwise into SplitPro.
date: 2026-10-10
updated: 2026-10-12
author: KM Koushik
tags: Splitwise, Guides
---

Moving to a new expense app is mostly about one thing: making sure nobody loses track of what they owe. This guide covers what SplitPro can import from Splitwise, how to get the file it needs, and a simple plan for switching a group without confusion.

## What gets imported

SplitPro's importer reads the file from our free [Splitwise exporter](https://export-splitwise.vercel.app/) and brings over:

- **Groups**, with their members and every past expense, including expenses you weren't part of.
- **Your expenses with friends outside groups**, including ones shared with several friends.
- **Payments**, as settle ups.

Deleted expenses are skipped, and so are comments, receipts and repeat settings. An expense several people paid for becomes one expense per person who paid, for what they paid, so totals and everyone's balance stay exact to the cent. If Splitwise doesn't say who owes whom in such an expense, its group or friends aren't imported rather than guessed.

Before saving a group, SplitPro adds up its expenses and compares the result with the balances listed in the same file. If they don't match, that group is left out and the summary at the end says why. The same goes for friends.

Many Splitwise groups **simplify debts**: Splitwise shows fewer payments, for example "Ada pays Cy" instead of "Ada pays Bo, Bo pays Cy". SplitPro doesn't simplify. It shows who owes whom from the expenses themselves. So in those groups everyone's total is the same as in Splitwise, but the amount between two people can be different. The import list marks these groups.

Each friend and group member is added by their email address. When they sign in to SplitPro with the same email, they see the same balances and history you do. Someone without an email address in Splitwise can't be matched, so a group or friend with them in it isn't imported.

## Step 1: Pick a good moment

The cleanest time to switch is between trips, right after a round of settling up. Smaller balances mean fewer questions later. It also helps to tell your group before you move, so nobody keeps adding expenses in the old app.

## Step 2: Get your data out of Splitwise

SplitPro reads the file from the [Splitwise exporter](https://export-splitwise.vercel.app/), not Splitwise's own JSON backup. The exporter uses your own Splitwise API key to download your friends, groups and expenses into one file. It doesn't store the key or your data.

1. Open [secure.splitwise.com/apps/new](https://secure.splitwise.com/apps/new) and register an app (any name works, e.g. "Export data").
2. Create an API key and copy it.
3. Paste it into the [exporter](https://export-splitwise.vercel.app/) and click **Download Data**. A long history can take a minute.

Splitwise says it may require a Splitwise Pro subscription to use its API. If the exporter says your key wasn't accepted, check the key first; that may be the reason.

Splitwise Pro also offers a **JSON backup** of your account. Its format isn't documented and it is a different file, so use the exporter's file for SplitPro.

## Step 3: Import into SplitPro

1. Sign in at [splitpro.app](https://splitpro.app) with the email you want to use.
2. Open **Account** and choose **Import from Splitwise**.
3. Choose the file from the exporter. SplitPro lists your groups and friends with how many expenses each has.
4. Untick anything you don't want to bring over, then tap **Import**.
5. When it's done, a summary lists what came over and anything that didn't, with the reason.

Each person's total in a group now matches Splitwise, and so does your balance with each friend outside groups. In groups that simplify debts, who owes whom can differ, as explained above, so your balance with one friend may too. Check two or three groups against Splitwise before you tell everyone you're done.

If you imported with an older version of the exporter, your balances came over without history. SplitPro won't add a group's history on top of those balances, because that would count them twice; the summary tells you which ones.

## Step 4: Bring your group along

Send your friends a short message with the link. Something like:

> We're moving our expenses to SplitPro (splitpro.app). It's free and has no daily limit. Sign in with the same email you use for Splitwise and our balances will be there.

Anyone who signs in with that email sees their balances straight away. People who would rather not install anything can use it in the browser. Those who want an app icon can add it to their home screen.

## Common questions

**What if someone in the group doesn't want to switch?** Their balance is still tracked, because you added it. They just won't see updates until they sign in. Settling up with them works the same as before.

**Can I import the same group twice?** Yes, nothing is added twice. Expenses already imported are skipped, by you or by anyone else in the group, so an import that stopped halfway can simply be run again. Once you've moved, add new expenses in SplitPro.

**What about recurring costs like rent?** Add the expense once and set it to repeat. SplitPro adds it again every week, month or year, just like an expense you add yourself.

**I only need to settle one last trip.** You don't have to import anything. Enter the trip's expenses into a free [quick split](/split), share the link, and start fresh in SplitPro.
