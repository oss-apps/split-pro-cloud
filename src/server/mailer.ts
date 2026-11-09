import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '~/env';
import { MAIL_NOT_CONFIGURED, isDefiniteSendFailure, safeMailErrorDetails } from './mailErrors';
import { sendToDiscord } from './service-notification';

let transporter: Transporter;
let boundedTransporter: Transporter;

/**
 * For sends a request waits on: gives up instead of hanging on a slow or silent server.
 */
const BOUNDED_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
};

/**
 * How long after it started a bounded send is certainly over, one way or another: each timeout
 * can run once, with room to spare for a server that answers just in time (the socket timeout is
 * for inactivity) and for the request's own database work.
 */
export const BOUNDED_SEND_SETTLED_MS =
  3 *
    (BOUNDED_TIMEOUTS.connectionTimeout +
      BOUNDED_TIMEOUTS.greetingTimeout +
      BOUNDED_TIMEOUTS.socketTimeout) +
  15_000;

const createTransporter = (timeouts?: typeof BOUNDED_TIMEOUTS) => {
  const host = env.EMAIL_SERVER_HOST;
  const port = parseInt(env.EMAIL_SERVER_PORT ?? '');
  const user = env.EMAIL_SERVER_USER;
  const pass = env.EMAIL_SERVER_PASSWORD;

  if (!host) {
    return;
  }

  const transport = {
    host,
    secure: port === 465,
    port,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: env.NODE_ENV !== 'development',
    },
    ...timeouts,
  };

  return nodemailer.createTransport(transport);
};

const getTransporter = () => {
  if (transporter) return transporter;

  const created = createTransporter();
  if (created) {
    transporter = created;
  }
  return created;
};

const getBoundedTransporter = () => {
  if (boundedTransporter) return boundedTransporter;

  const created = createTransporter(BOUNDED_TIMEOUTS);
  if (created) {
    boundedTransporter = created;
  }
  return created;
};

export async function sendSignUpEmail(email: string, token: string, url: string) {
  const { host } = new URL(url);

  console.log(env.NODE_ENV);

  if (env.NODE_ENV === 'development') {
    console.log('Sign in link : ', email, url, token);
    return true;
  }

  const subject = 'Sign in to SplitPro';
  const text = `Hey,\n\nYou can sign in to SplitPro by clicking the below URL:\n${url}\n\nYou can also use this code: ${token}\n\nThe link and code expire in 10 minutes.\n\nThanks,\nSplitPro Team`;
  const html = `<p>Hey,</p> <p>You can sign in to SplitPro by clicking the below URL:</p><p><a href="${url}">Sign in to ${host}</a></p><p>You can also use this code: <b>${token}</b></p><p>The link and code expire in 10 minutes.</p><br /><br /><p>Thanks,</p><br/>SplitPro Team</p>`;

  return await sendMail(email, subject, text, html);
}

export async function sendAccountDeletionCodeEmail(
  email: string,
  token: string,
  expiresInMinutes: number,
) {
  if (env.NODE_ENV === 'development') {
    console.log('Account deletion code : ', email, token);
    return true;
  }

  const subject = 'Confirm account deletion';
  const text = `Hey,\n\nUse this code to confirm deleting your SplitPro account: ${token}\n\nThe code expires in ${expiresInMinutes} minutes.\n\nIf you didn't ask to delete your account, you can ignore this email and your account stays as it is.\n\nThanks,\nSplitPro Team`;
  const html = `<p>Hey,</p><p>Use this code to confirm deleting your SplitPro account: <b>${token}</b></p><p>The code expires in ${expiresInMinutes} minutes.</p><p>If you didn't ask to delete your account, you can ignore this email and your account stays as it is.</p><br /><p>Thanks,<br/>SplitPro Team</p>`;

  return await sendMail(email, subject, text, html);
}

export async function sendAccountDeletedEmail(email: string) {
  if (env.NODE_ENV === 'development') {
    console.log('Account deleted email : ', email);
    return true;
  }

  const subject = 'Your SplitPro account was deleted';
  const text = `Hey,\n\nYour SplitPro account was deleted. Your name and email address were removed. Expenses you shared stay with the people you shared them with.\n\nYou're welcome to sign up again any time.\n\nThanks,\nSplitPro Team`;
  const html = `<p>Hey,</p><p>Your SplitPro account was deleted. Your name and email address were removed. Expenses you shared stay with the people you shared them with.</p><p>You're welcome to sign up again any time.</p><br /><p>Thanks,<br/>SplitPro Team</p>`;

  return await sendMail(email, subject, text, html);
}

export async function sendInviteEmail(email: string, name: string) {
  if (!env.ENABLE_SENDING_INVITES) {
    throw new Error('Sending invites is not enabled');
  }

  const { host } = new URL(env.NEXTAUTH_URL);

  if (env.NODE_ENV === 'development') {
    console.log('Sending invite email', email, name);
    return;
  }

  const subject = 'Invitation to SplitPro';
  const text = `Hey,\n\nYou have been invited to SplitPro by ${name}. It's a completely open source free alternative to splitwise. You can sign in to SplitPro by clicking the below URL:\n${env.NEXTAUTH_URL}\n\nThanks,\nSplitPro Team`;
  const html = `<p>Hey,</p> <p>You have been invited to SplitPro by ${name}. It's a completely open source free alternative to splitwise. You can sign in to SplitPro by clicking the below URL:</p><p><a href="${env.NEXTAUTH_URL}">Sign in to ${host}</a></p><br><p>Thanks,<br/>SplitPro Team</p>`;

  await sendMail(email, subject, text, html);
}

export type FeedbackEmailDetails = {
  id: string;
  message: string;
  email: string;
  name: string | null;
  source: string;
  appVersion: string | null;
};

/**
 * Tells us about new feedback. The subject keeps the `Feedback received on SplitPro` prefix that
 * existing inbox filters match. Best effort: returns whether it was sent, and on failure logs and
 * reports only the feedback id and error codes, never the recipient or the server's reply.
 */
export async function sendFeedbackEmail(
  feedback: FeedbackEmailDetails,
  deliver: typeof deliverMail = deliverMail,
) {
  if (!env.FEEDBACK_EMAIL) return false;

  const sender = feedback.name ?? feedback.email;
  const subject = `Feedback received on SplitPro from ${sender}`;
  const version = feedback.appVersion ? ` ${feedback.appVersion}` : '';
  const text = `Feedback created by ${sender} :\n\nFeedback: ${feedback.message}\n\nemail: ${feedback.email}\nsource: ${feedback.source}${version}\nfeedback id: ${feedback.id}`;
  const html = `<p>Feedback created by ${escapeHtml(sender)}:</p><p style="white-space: pre-wrap">${escapeHtml(feedback.message)}</p><p>email: ${escapeHtml(feedback.email)}<br/>source: ${escapeHtml(feedback.source + version)}<br/>feedback id: ${escapeHtml(feedback.id)}</p>`;

  try {
    await deliver(env.FEEDBACK_EMAIL, subject, text, html, feedback.email);
    return true;
  } catch (error) {
    const { code, responseCode } = safeMailErrorDetails(error);
    console.error('Feedback email not sent', { feedbackId: feedback.id, code, responseCode });
    await sendToDiscord(
      `Feedback email not sent for feedback ${feedback.id} (code: ${code ?? 'unknown'}, response code: ${responseCode ?? 'none'})`,
    ).catch(() => undefined);
    return false;
  }
}

/**
 * Replies to someone's feedback, quoting what they sent. Unlike the other emails this throws when
 * the email can't be sent, so the caller doesn't record a reply that never went out.
 */
export async function sendFeedbackReplyEmail({
  to,
  reply,
  original,
}: {
  to: string;
  reply: string;
  original: string;
}) {
  const subject = 'Re: your SplitPro feedback';
  const quoted = original
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  const text = `${reply}\n\n${quoted}`;
  const html = `<p style="white-space: pre-wrap">${escapeHtml(reply)}</p><blockquote style="margin: 16px 0 0; padding-left: 12px; border-left: 3px solid #ccc; color: #666; white-space: pre-wrap">${escapeHtml(original)}</blockquote>`;

  await deliverMail(to, subject, text, html, env.FEEDBACK_EMAIL);
}

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * An email that wasn't sent, or might not have been. Carries only nodemailer's error code and the
 * SMTP reply code, never the error message, so it's safe to log.
 */
export class MailNotSentError extends Error {
  /** True when the server certainly didn't accept the message, so retrying can't send it twice. */
  definite: boolean;
  code?: string;
  responseCode?: number;

  constructor(error: unknown) {
    super('Email not sent');
    this.name = 'MailNotSentError';
    this.definite = isDefiniteSendFailure(error);
    Object.assign(this, safeMailErrorDetails(error));
  }
}

/**
 * Sends an email with bounded timeouts and throws `MailNotSentError` when SMTP isn't configured or
 * sending fails.
 */
async function deliverMail(
  email: string,
  subject: string,
  text: string,
  html: string,
  replyTo?: string,
) {
  const transporter = getBoundedTransporter();
  if (!transporter) {
    throw new MailNotSentError({ code: MAIL_NOT_CONFIGURED });
  }

  try {
    await transporter.sendMail({ to: email, from: env.FROM_EMAIL, subject, text, html, replyTo });
  } catch (error) {
    throw new MailNotSentError(error);
  }
}

async function sendMail(
  email: string,
  subject: string,
  text: string,
  html: string,
  replyTo?: string,
) {
  const transporter = getTransporter();
  try {
    if (transporter) {
      await transporter.sendMail({
        to: email,
        from: env.FROM_EMAIL,
        subject,
        text,
        html,
        replyTo,
      });

      console.log('Email sent');
      return true;
    } else {
      console.log('SMTP server not configured, so skipping');
    }
  } catch (error) {
    console.log('Error sending email', error);
    await sendToDiscord(
      `Error sending email: ${
        error instanceof Error
          ? `error.message: ${error.message}\nerror.stack: ${error.stack}`
          : 'Unknown error'
      }`,
    );
  }

  return false;
}
