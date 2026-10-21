import { type User } from 'next-auth';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '~/env';
import { sendToDiscord } from './service-notification';

let transporter: Transporter;

const getTransporter = () => {
  if (transporter) return transporter;

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
  };

  transporter = nodemailer.createTransport(transport);
  return transporter;
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

export async function sendFeedbackEmail(feedback: string, user: User) {
  console.log('Received feedback from: ', user.email, 'Feedback: ', feedback);

  if (!env.FEEDBACK_EMAIL) return;

  const subject = `Feedback received on SplitPro from ${user.name}`;
  const text = `Feedback created by ${user.name} :\n\nFeedback: ${feedback}\n\nemail: ${user.email}`;

  await sendMail(env.FEEDBACK_EMAIL, subject, text, text, user.email ?? undefined);
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
