import React, { useMemo, useState } from 'react';
import { AppDrawer } from '../ui/drawer';
import { ChevronRight, MessageSquare, Pencil } from 'lucide-react';
import { api } from '~/utils/api';
import { Textarea } from '../ui/textarea';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormMessage } from '../ui/form';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import { type TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

const getDetailsSchema = (t: TFunction) =>
  z.object({
    name: z
      .string({ required_error: t('errors.name_required') })
      .min(1, { message: t('errors.name_required') }),
  });

type DetailsValues = z.infer<ReturnType<typeof getDetailsSchema>>;

export const UpdateDetails: React.FC<{ defaultName: string }> = ({ defaultName }) => {
  const { t } = useTranslation();
  const detailsSchema = useMemo(() => getDetailsSchema(t), [t]);
  const updateDetailsMutation = api.user.updateUserDetail.useMutation();
  const [updateDetailsOpen, setUpdateDetailsOpen] = useState(false);

  const detailForm = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      name: defaultName,
    },
  });

  const utils = api.useUtils();

  async function onGroupSubmit(values: DetailsValues) {
    try {
      await updateDetailsMutation.mutateAsync({ name: values.name });
      toast.success(t('account.messages.submit_success'), { duration: 1500 });
      utils.user.me.refetch().catch(console.error);
    } catch (error) {
      toast.error(t('account.messages.submit_error'));

      console.error(error);
    }
    setUpdateDetailsOpen(false);
  }

  return (
    <AppDrawer
      trigger={<Pencil className="h-5 w-5" />}
      onTriggerClick={() => setUpdateDetailsOpen(true)}
      open={updateDetailsOpen}
      onClose={() => setUpdateDetailsOpen(false)}
      onOpenChange={(open) => setUpdateDetailsOpen(open)}
      leftAction={t('actions.close')}
      title={t('account.edit_name.title')}
      className="h-[80vh]"
      actionTitle={t('actions.save')}
      actionOnClick={async () => {
        await detailForm.handleSubmit(onGroupSubmit)();
      }}
    >
      <div>
        <Form {...detailForm}>
          <form
            onSubmit={detailForm.handleSubmit(onGroupSubmit)}
            className="mt-4 flex w-full items-start gap-4"
          >
            <FormField
              control={detailForm.control}
              name="name"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormControl>
                    <Input
                      className="text-lg"
                      placeholder={t('account.edit_name.placeholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </div>
    </AppDrawer>
  );
};
