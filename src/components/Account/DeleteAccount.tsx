import { TRPCClientError } from '@trpc/client';
import { REGEXP_ONLY_DIGITS_AND_CHARS } from 'input-otp';
import { AlertTriangle, Mail, Receipt, User, UserX } from 'lucide-react';
import { signOut } from 'next-auth/react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '~/lib/utils';
import { type AppRouter } from '~/server/api/root';
import { api } from '~/utils/api';
import { toUIString } from '~/utils/numbers';

import { Button } from '../ui/button';
import { AppDrawer } from '../ui/drawer';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../ui/input-otp';
import { Skeleton } from '../ui/skeleton';

const CODE_LENGTH = 6;

const isApiError = (error: unknown): error is TRPCClientError<AppRouter> =>
  error instanceof TRPCClientError;

/** When the server asked to wait (too many codes or guesses), from the error's data. */
const lockedUntil = (error: unknown) => {
  const seconds =
    isApiError(error) && 'TOO_MANY_REQUESTS' === error.data?.code
      ? error.data.retryAfterSeconds
      : null;
  return seconds ? Date.now() + seconds * 1000 : null;
};

const errorMessage = (error: unknown) =>
  isApiError(error) ? error.message : 'Something went wrong. Please try again.';

/** Whole seconds left until `until` (a timestamp), ticking every second; 0 once it has passed. */
const useSecondsLeft = (until: number | null) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (null === until) {
      return;
    }

    setNow(Date.now());
    const interval = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [until]);

  return null === until ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
};

const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const Section: React.FC<{ title: string; footer: string; children: React.ReactNode }> = ({
  title,
  footer,
  children,
}) => (
  <div>
    <p className="mb-2 text-sm text-gray-500">{title}</p>
    <div className="flex flex-col divide-y divide-gray-800 rounded-md border border-gray-800 px-3">
      {children}
    </div>
    <p className="mt-2 text-xs text-gray-500">{footer}</p>
  </div>
);

/**
 * Deletes the account like the app does: what happens first, then the code we email. The web has
 * no Sign in with Apple, so an account linked to Apple is deleted without revoking it.
 */
export const DeleteAccount: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'explain' | 'code'>('explain');
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resendLockedUntil, setResendLockedUntil] = useState<number | null>(null);
  const [verifyLockedUntil, setVerifyLockedUntil] = useState<number | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const resendSecondsLeft = useSecondsLeft(resendLockedUntil);
  const verifySecondsLeft = useSecondsLeft(verifyLockedUntil);

  const infoQuery = api.user.getDeleteAccountInfo.useQuery(undefined, { enabled: open });
  const requestCode = api.user.requestDeleteAccountCode.useMutation();
  const deleteAccount = api.user.deleteAccount.useMutation();

  const info = infoQuery.data;
  const isLocked = 0 < verifySecondsLeft;
  const deleting = deleteAccount.isLoading || signingOut;

  const onOpenChange = (next: boolean) => {
    if (deleting) {
      return;
    }

    setOpen(next);
    if (!next) {
      setStep('explain');
      setCode('');
      setError(null);
    }
  };

  const sendCode = async () => {
    try {
      const sent = await requestCode.mutateAsync();
      setEmail(sent.email);
      setCode('');
      setError(null);
      setVerifyLockedUntil(null);
      setResendLockedUntil(Date.now() + sent.resendAfterSeconds * 1000);
      if ('code' === step) {
        toast.success('We sent you a new code');
      }
      setStep('code');
    } catch (sendError) {
      const until = lockedUntil(sendError);
      if (until) {
        setResendLockedUntil(until);
      }
      // A code sent a moment ago still works, so go on to enter it
      if (until && 'explain' === step && info?.email) {
        setEmail(info.email);
        setStep('code');
        return;
      }
      toast.error(errorMessage(sendError));
    }
  };

  const confirmDelete = async () => {
    if (deleting || isLocked) {
      return;
    }

    if (CODE_LENGTH !== code.length) {
      setError(`Enter the ${CODE_LENGTH}-character code`);
      return;
    }

    setError(null);

    try {
      await deleteAccount.mutateAsync({ code });
    } catch (deleteError) {
      const until = lockedUntil(deleteError);
      if (until) {
        // Too many guesses burn the code
        setCode('');
        setVerifyLockedUntil(until);
      } else {
        setError(errorMessage(deleteError));
      }
      return;
    }

    // The server already ended every session; this clears the cookie and leaves the app
    setSigningOut(true);
    await signOut({ callbackUrl: '/auth/signin?deleted=1' });
  };

  const status = isLocked
    ? `Too many attempts. Try again in ${formatDuration(verifySecondsLeft)}.`
    : error;

  return (
    <AppDrawer
      trigger={
        <Button variant="ghost" className="text-red-500 hover:text-red-500/90">
          Delete account
        </Button>
      }
      open={open}
      onOpenChange={onOpenChange}
      onClose={() => onOpenChange(false)}
      leftAction="Cancel"
      title="Delete account"
      className="h-[85vh]"
      dismissible={!deleting}
    >
      {'code' === step ? (
        <div className="mx-auto flex w-full max-w-[340px] flex-col items-center gap-6 pt-2">
          <div className="flex flex-col items-center gap-2 text-center">
            <Mail className="h-10 w-10 text-cyan-500" />
            <p className="text-lg font-semibold">Check your email</p>
            <p className="text-sm text-gray-400">
              Enter the code we sent to {email ?? ''} to delete your account.
            </p>
          </div>

          <div className="flex flex-col items-center gap-2">
            <InputOTP
              maxLength={CODE_LENGTH}
              pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
              inputMode="text"
              autoFocus
              value={code}
              disabled={isLocked || deleting}
              onChange={(value) => {
                setCode(value.toUpperCase());
                setError(null);
              }}
              onComplete={() => setError(null)}
            >
              <InputOTPGroup>
                {Array.from({ length: CODE_LENGTH }, (_, index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className={cn('h-12 w-12 text-base uppercase', status && 'border-red-500')}
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
            {status ? (
              <p className="text-center text-sm text-red-500" aria-live="polite">
                {status}
              </p>
            ) : null}
          </div>

          <div className="flex w-full flex-col gap-2">
            <Button
              variant="destructive"
              className="w-full"
              loading={deleting}
              disabled={isLocked || deleting || CODE_LENGTH !== code.length}
              onClick={confirmDelete}
            >
              Delete account
            </Button>
            <Button
              variant="ghost"
              className="w-full py-2 text-cyan-500 hover:text-cyan-500/80"
              disabled={0 < resendSecondsLeft || requestCode.isLoading || deleting}
              onClick={sendCode}
            >
              {0 < resendSecondsLeft
                ? `Resend code in ${formatDuration(resendSecondsLeft)}`
                : 'Resend code'}
            </Button>
            <Button
              variant="ghost"
              className="w-full py-2 text-gray-400"
              disabled={deleting}
              onClick={() => {
                setStep('explain');
                setError(null);
              }}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6 pt-2">
          <div className="flex flex-col items-center gap-2 text-center">
            <UserX className="h-10 w-10 text-red-500" />
            <p className="text-lg font-semibold">Delete your SplitPro account?</p>
          </div>

          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-start gap-3">
              <User className="h-5 w-5 shrink-0 text-gray-400" />
              <p>Your name and email are removed, and you&apos;re signed out on every device.</p>
            </div>
            <div className="flex items-start gap-3">
              <Receipt className="h-5 w-5 shrink-0 text-blue-500" />
              <p>Expenses you share stay for the others, under &quot;Deleted user&quot;.</p>
            </div>
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
              <p>This can&apos;t be undone.</p>
            </div>
          </div>

          {!info ? <Skeleton className="h-12 w-full" /> : null}

          {info && 0 < info.balances.length ? (
            <Section
              title="Outstanding balances"
              footer="These stay with your friends. You may want to settle up first."
            >
              {info.balances.map((balance) => (
                <div
                  key={balance.currency}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <p>{0 < balance.amount ? 'You get' : 'You owe'}</p>
                  <p className={0 < balance.amount ? 'text-emerald-500' : 'text-orange-600'}>
                    {balance.currency.toUpperCase()} {toUIString(balance.amount)}
                  </p>
                </div>
              ))}
            </Section>
          ) : null}

          {info && 0 < info.groups.length ? (
            <Section
              title="Groups you created"
              footer="Groups pass to another member, and ones only you are in are deleted. You stay in groups where you still have a balance, so it can be settled."
            >
              {info.groups.map((group) => (
                <div key={group.id} className="flex items-center justify-between gap-4 py-3">
                  <p className="truncate text-sm">{group.name}</p>
                  <p className="shrink-0 text-xs text-gray-500">
                    {group.nextOwnerName
                      ? `Goes to ${group.nextOwnerName}`
                      : group.willBeDeleted
                        ? 'Will be deleted'
                        : null}
                  </p>
                </div>
              ))}
            </Section>
          ) : null}

          <div className="flex flex-col gap-3">
            <Button
              variant="destructive"
              className="w-full"
              loading={requestCode.isLoading}
              disabled={!info || requestCode.isLoading}
              onClick={sendCode}
            >
              Delete account
            </Button>
            <p className="text-center text-xs text-gray-500">
              {info?.email
                ? `We'll email a code to ${info.email} to confirm.`
                : "We'll email you a code to confirm."}
            </p>
          </div>
        </div>
      )}
    </AppDrawer>
  );
};
