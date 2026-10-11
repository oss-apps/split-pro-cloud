import Avatar from 'boring-avatars';
import React, { useState } from 'react';
import { AppDrawer } from '~/components/ui/drawer';
import { Input } from '~/components/ui/input';
import { api } from '~/utils/api';
import { useRouter } from 'next/router';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormMessage } from '../ui/form';
import { Button } from '../ui/button';
import { CURRENCIES } from '~/lib/currency';
import { useAddExpenseStore } from '~/store/addStore';
import { useRecentCurrencies } from '~/hooks/useRecentCurrencies';

const groupSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).min(1, { message: 'Name is required' }),
});

export const CreateGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const preferredCurrency = useAddExpenseStore((s) => s.preferredCurrency);
  const { recent: recentCurrencies, remember: rememberCurrency } = useRecentCurrencies();
  const [currency, setCurrency] = useState<string | undefined>();
  const groupCurrency = currency ?? preferredCurrency ?? 'USD';

  const createGroup = api.group.create.useMutation(undefined);
  const utils = api.useUtils();

  const groupForm = useForm<z.infer<typeof groupSchema>>({
    resolver: zodResolver(groupSchema),
  });

  const router = useRouter();

  async function onGroupSubmit(values: z.infer<typeof groupSchema>) {
    await createGroup.mutateAsync(
      { name: values.name, currency: groupCurrency },
      {
        onSuccess: (data) => {
          rememberCurrency(data.defaultCurrency);
          utils.group.getAllGroupsWithBalances.refetch().catch(console.error);
          router
            .push(`/groups/${data.id}`)
            .then(() => setDrawerOpen(false))
            .catch(console.error);
        },
      },
    );
  }

  return (
    <>
      <AppDrawer
        open={drawerOpen}
        onOpenChange={(openVal) => {
          if (openVal !== drawerOpen) setDrawerOpen(openVal);
          // Every new group starts from the user's own currency.
          if (openVal) setCurrency(undefined);
        }}
        trigger={children}
        leftAction="Cancel"
        leftActionOnClick={() => setDrawerOpen(false)}
        title="Create a group"
        className="h-[70vh]"
        actionTitle="Submit"
        actionOnClick={async () => {
          await groupForm.handleSubmit(onGroupSubmit)();
        }}
      >
        <div className="w-full">
          <Form {...groupForm}>
            <form
              onSubmit={groupForm.handleSubmit(onGroupSubmit)}
              className="mt-4 flex w-full items-start gap-4"
            >
              <Avatar
                size={50}
                name={groupForm.watch('name')}
                variant="bauhaus"
                colors={['#80C7B7', '#D9C27E', '#F4B088', '#FFA5AA', '#9D9DD3']}
              />
              <FormField
                control={groupForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="w-full">
                    <FormControl>
                      <Input placeholder="Group name" className="w-full py-2 text-lg" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
          <label className="mt-6 flex items-center justify-between gap-4 text-sm text-gray-400">
            Currency
            <select
              value={groupCurrency}
              onChange={(e) => setCurrency(e.target.value)}
              className="h-10 max-w-[60%] rounded-md border bg-background px-3 text-foreground"
            >
              {recentCurrencies.length ? (
                <optgroup label="Recent">
                  {recentCurrencies.map((code) => (
                    <option key={code} value={code}>
                      {code} · {CURRENCIES.find((c) => c.code === code)?.name ?? code}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="All currencies">
                {CURRENCIES.filter((c) => !recentCurrencies.includes(c.code)).map((c) => (
                  <option key={`${c.code}-${c.name}`} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <p className="mt-2 text-xs text-gray-500">
            New expenses in this group use it by default.
          </p>
        </div>
      </AppDrawer>
    </>
  );
};
