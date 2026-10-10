---
title: Splitwise alternatives without a daily expense limit
description: Splitwise's free plan now caps how many expenses you can add each day. Here is what to look for in a replacement, and the options worth trying.
date: 2026-10-10
author: KM Koushik
tags: Splitwise, Guides
---

Splitwise is still the app most people think of when they need to split costs. But if you use it on the free plan, you have probably met the upgrade screen. Splitwise's help center says that [free users can add up to 4 expenses each day](https://kb.splitwise.com/pro/what-is-splitwise-pro). After that, you wait until tomorrow, ask a friend to add the expense for you, or pay for Pro.

Four a day sounds like plenty until you go on a trip. Breakfast, train tickets, a museum, lunch, groceries and dinner is already six. So people start batching expenses at night, or keeping notes to add later, and the whole point of the app, writing it down while you remember, gets lost.

This guide is about what to look for in an alternative, and which ones are worth a look.

## What a good replacement needs

Before comparing apps, it helps to know what actually matters when you split money with other people.

**No cap on the core feature.** Adding an expense is the one thing the app is for. Charge for extras if you must, but a limit on the basic action pushes people away from recording things as they happen.

**Uneven splits.** Real life is rarely 50/50. You need to split by exact amounts, by percentage or by shares, and leave someone out of an expense they weren't part of.

**Multiple currencies.** If you travel, each expense should keep the currency it was paid in. Mixing a trip in euros with rent in dollars makes balances hard to trust.

**Something everyone can use.** In every group there is someone who will not install a new app. A web app that works in any browser, and can be added to the home screen by those who want it, removes that argument.

**Your data, exportable.** You should be able to download what you've entered, and leave without losing years of history.

**A reason to believe it will stay this way.** Free apps change their plans. An open source app is harder to lock down, because anyone can run their own copy of the code.

## The options

### SplitPro

[SplitPro](https://splitpro.app) is the app we build, so take this section with that in mind. It is free, open source under the MIT license, and has no limit on how many expenses you add.

- Groups, one-to-one balances, and every common split type: equal, percentage, shares, exact amounts and adjustments.
- More than 100 currencies, with balances kept per currency.
- Receipt photos, push notifications, and it installs on your phone from the browser.
- Imports your friends and groups from Splitwise, with their balances.
- You can use the hosted version at splitpro.app, or [run it yourself](https://github.com/oss-apps/split-pro).

What it doesn't do yet: the Splitwise import brings over balances, not every past expense. If you need your full history, keep a Splitwise export as a record.

### Spliit

[Spliit](https://spliit.app) is another open source project. It works without accounts: you create a group, share the link, and everyone adds expenses from that page. That makes it very quick for a one-off trip with people you won't split with again. The trade-off is that there is no personal account tying all your groups and friends together.

### Tricount, Settle Up and other mobile apps

Tricount and Settle Up are popular mobile apps with free plans. Both are built around groups, and both are worth trying if you prefer a native app. Check what each free plan includes today, because plans change over time, and that is exactly the problem we are trying to avoid.

### A shared spreadsheet

A Google Sheet with columns for date, description, who paid and the amount works, and costs nothing. It falls apart when splits are uneven or there are several currencies, and someone has to own the formulas. It is a good fallback for a group of two, and a hard one for six.

## Quick comparison

|                    | SplitPro  | Spliit    | Spreadsheet     |
| ------------------ | --------- | --------- | --------------- |
| Expenses per day   | Unlimited | Unlimited | Unlimited       |
| Account needed     | Yes, free | No        | Google account  |
| Uneven splits      | Yes       | Yes       | Manual formulas |
| Works in a browser | Yes       | Yes       | Yes             |
| Open source        | Yes       | Yes       | n/a             |

## How to switch without losing track

The easiest switch happens between trips, not in the middle of one.

1. **Settle what you can** in Splitwise first, so you start with smaller balances.
2. **Export a record** of each group from Splitwise, in case you ever need to look something up.
3. **Import or re-create** your groups in the new app, and tell everyone where to find them.

We wrote a step-by-step guide for the third part: [how to move from Splitwise to SplitPro](/blog/move-from-splitwise-to-splitpro).

And if you just need to settle one trip right now, without signing up for anything, our free [settle-up calculator](/tools/settle-up) works out who owes whom in a minute.
