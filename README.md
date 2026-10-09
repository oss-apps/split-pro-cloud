<p align="center" style="margin-top: 12px">
  <a href="https://splitpro.app">
  <img width="100px"  style="border-radius: 50%;" src="https://splitpro.app/logo_circle.png" alt="SplitPro Logo">
  </a>

  <h1 align="center">SplitPro</h1>
  <h2 align="center">An open source alternative to Splitwise</h2>

<p align="center">
    <a href="https://splitpro.app"><strong>Open splitpro.app »</strong></a>
    <br />
    <br />
  </p>
</p>

> [!IMPORTANT]
> This repository is for the hosted instance at [splitpro.app](https://splitpro.app). If you use splitpro.app, post your issues here.
>
> To self-host SplitPro, use [oss-apps/split-pro](https://github.com/oss-apps/split-pro).

## About

[splitpro.app](https://splitpro.app) is the online version of SplitPro, an open source way to share expenses with friends. It is designed as a replacement for Splitwise.

There is nothing to install or run. Sign in and start adding expenses, for free.

## Getting started

1. Open [splitpro.app](https://splitpro.app).
2. Sign in with Google or with your email (we send you a sign-in link).
3. Add a friend or create a group, and add your first expense.
4. Install it on your phone: open splitpro.app in your browser and choose **Add to Home Screen**. It works like a regular app and can send you notifications.

## Features

- Add expenses with a friend or a group.
- Split methods: equal, percentage, share, exact amounts, adjustments, and settlements.
- Multiple currencies.
- Categories, dates, and receipt uploads.
- Overall balances across friends and groups, with a detailed view per person and per group.
- Activity feed for everything that happens in your groups.
- Invite friends to a group with a link or by email.
- Push notifications for new expenses.
- Import friends and groups from Splitwise.
- Download all your data at any time.

## Screenshots

![SplitPro banner](public/og_banner.png)

![Desktop balances view](public/Desktop.webp)

![Mobile balances view](public/hero.webp)

## Using splitpro.app

### Groups

Groups are the easiest way to use SplitPro. Create a group for a trip, your home or a dinner, share the invite link, and everyone who joins can add expenses. Group balances show who owes whom, and settling up records a payment.

### Friends

You don't need a group to split with one person. Add a friend by email and split expenses directly. Their balance shows up on your home screen.

### Install as an app

splitpro.app is a PWA. On iOS, open it in Safari, tap **Share** and then **Add to Home Screen**. On Android and desktop, use the install option in your browser's menu. Turn on notifications from the **Account** page.

### Moving from Splitwise

Go to **Account** and choose **Import from Splitwise** to bring over your friends and groups.

### Your data

Your data is yours. You can download everything you have stored on splitpro.app from the **Account** page. See the [privacy policy](https://splitpro.app/privacy) and [terms](https://splitpro.app/terms).

## Reporting issues

- **Something wrong on splitpro.app?** [Open an issue here](https://github.com/oss-apps/split-pro-cloud/issues/new/choose). Include your device, browser and the steps to reproduce it. Never post personal data or expense details you don't want to be public.
- **Running your own SplitPro server?** Use [oss-apps/split-pro](https://github.com/oss-apps/split-pro) instead.

## Why

Splitwise is one of the best apps to add expenses and bills.

I understand that every app needs to make money, After all, lots of effort has been put into Splitwise. My main problem is how they implemented this.

Monetising on pro features or ads is fine, but asking money for adding expenses (core feature) is frustrating.

I was searching for other open-source alternatives (Let's be honest, any closed-source product might do the same and I don't have any reason to believe otherwise).

I managed to find a good app [spliit.app](https://spliit.app/) by [Sebastien Castiel](https://scastiel.dev/) but it's not a complete replacement and didn't suit my workflow sadly. Check it out to see if it fits you.

_That's when I decided to work on this_

## FAQ

#### Is splitpro.app free?

Yes. Adding expenses, groups and friends is free, with no limits on the number of expenses.

#### How precise are the numbers?

All amounts are stored as whole numbers in the smallest unit of the currency (for example cents), never as floating point numbers. This keeps your balances free of rounding errors.

#### Can I host SplitPro myself instead?

Yes. Self-hosted SplitPro lives in [oss-apps/split-pro](https://github.com/oss-apps/split-pro), with Docker images and setup guides.

## Tech stack

- [NextJS](https://nextjs.org/)
- [Tailwind](https://tailwindcss.com/)
- [tRPC](https://trpc.io/)
- [ShadcnUI](https://ui.shadcn.com/)
- [Prisma](https://www.prisma.io/)
- [Postgres](https://www.postgresql.org/)
- [NextAuth](https://next-auth.js.org/)

## Contributing

Contributions to splitpro.app are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Prerequisites

- Node.js (Version: >=18.x)
- PostgreSQL
- pnpm (recommended)

### Install dependencies

```bash
corepack enable
```

```bash
pnpm i
```

### Set up the environment

- Copy the env.example file into .env
- Setup google oauth required for auth https://next-auth.js.org/providers/google or Email provider by setting SMTP details
- Login to minio console using `splitpro` user and password `password` and [create access keys](http://localhost:9001/access-keys/new-account) and the R2 related env variables

### Run the app

```bash
pnpm d
```

## Sponsors

We are grateful for the support of our sponsors.

### Our Sponsors

<a href="https://hekuta.net/en" target="_blank">
  <img src="https://avatars.githubusercontent.com/u/70084358?v=4" alt="hekuta" style="width:60px;height:60px;">
</a>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=oss-apps/split-pro&type=Date)](https://star-history.com/#oss-apps/split-pro&Date)
