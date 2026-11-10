import React, { useRef, useState } from 'react';
import { AppDrawer } from '../ui/drawer';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { api } from '~/utils/api';
import { Textarea } from '../ui/textarea';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormMessage } from '../ui/form';
import { toast } from 'sonner';
import { type DraftKey, keyForDraft } from '~/utils/draftKey';

const feedbackSchema = z.object({
  feedback: z
    .string({ required_error: 'Feedback is required' })
    .trim()
    .min(10, { message: 'Feedback should be at least 10 characters' })
    .max(5000, { message: 'Feedback should be at most 5000 characters' }),
});

export const SubmitFeedback: React.FC = () => {
  const submitFeedbackMutation = api.user.submitFeedback.useMutation();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Resending the same text (a double tap, a retry) reuses its key, so it's saved once
  const draftKey = useRef<DraftKey | null>(null);
  // Covers taps before the disabled button re-renders
  const submitting = useRef(false);

  const feedbackForm = useForm<z.infer<typeof feedbackSchema>>({
    resolver: zodResolver(feedbackSchema),
  });

  async function onGroupSubmit(values: z.infer<typeof feedbackSchema>) {
    if (submitting.current) {
      return;
    }

    submitting.current = true;
    draftKey.current = keyForDraft(draftKey.current, values.feedback, () => crypto.randomUUID());
    try {
      await submitFeedbackMutation.mutateAsync({
        feedback: values.feedback,
        clientKey: draftKey.current.key,
        source: 'web',
      });
    } catch (e) {
      // Keep the drawer and the text, so it can be sent again as it is
      toast.error('Failed to submit feedback, please try again');
      return;
    } finally {
      submitting.current = false;
    }

    feedbackForm.reset({ feedback: '' });
    draftKey.current = null;
    toast.success('Feedback submitted', { duration: 1500 });
    setFeedbackOpen(false);
  }

  return (
    <AppDrawer
      trigger={
        <div className="flex w-full justify-between px-0 py-2 text-[16px] font-medium text-gray-300 hover:text-foreground/80">
          <div className="flex items-center gap-4 text-[16px]">
            <MessageSquare className="h-5 w-5 text-green-500" />
            Submit feedback
          </div>
          <ChevronRight className="h-6x w-6 text-gray-500" />
        </div>
      }
      open={feedbackOpen}
      onOpenChange={setFeedbackOpen}
      onClose={() => setFeedbackOpen(false)}
      leftAction="Close"
      title="Submit a feedback"
      className="h-[70vh]"
      shouldCloseOnAction={false}
      actionTitle="Submit"
      actionDisabled={submitFeedbackMutation.isLoading}
      actionOnClick={async () => {
        await feedbackForm.handleSubmit(onGroupSubmit)();
      }}
    >
      <div>
        <Form {...feedbackForm}>
          <form
            onSubmit={feedbackForm.handleSubmit(onGroupSubmit)}
            className="mt-4 flex w-full items-start gap-4"
          >
            <FormField
              control={feedbackForm.control}
              name="feedback"
              render={({ field }) => (
                <FormItem className="w-full">
                  <FormControl>
                    <Textarea
                      className="text-lg placeholder:text-sm"
                      rows={5}
                      placeholder="Enter your feedback"
                      {...field}
                    ></Textarea>
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
