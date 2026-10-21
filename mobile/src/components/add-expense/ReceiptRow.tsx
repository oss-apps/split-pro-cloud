import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionSheetIOS, Platform, StyleSheet } from 'react-native';

import { FILE_SIZE_LIMIT } from '~/lib/constants';

import { Icon, ListRow, Sheet, Spinner, Text, icons, rowInset, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { isCurrentForm, uploadReceipt, useAddExpenseStore } from '@/store/addExpenseStore';
import { colors, radii } from '@/theme/tokens';

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
const ICON_SIZE = 22;

type Choice = 'camera' | 'library' | 'remove';

/**
 * The receipt row: attaches a photo like the web's UploadFile (uploaded straight to storage with a
 * presigned URL from `user.getUploadUrl`, the form keeps its key), or removes it. The choices open
 * in an action sheet on iOS and a bottom sheet on Android.
 */
export const ReceiptRow: React.FC<{ isEditing: boolean }> = ({ isEditing }) => {
  const { t } = useTranslation();
  const isUploading = useAddExpenseStore((s) => s.isFileUploading);
  const hasReceipt = useAddExpenseStore((s) => !!s.fileKey);
  const getUploadUrl = api.user.getUploadUrl.useMutation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [preview, setPreview] = useState<string>();
  // Android can't present the picker while the sheet is still closing, so it opens once it's gone.
  const choiceAfterClose = useRef<Choice | null>(null);

  const pick = async (source: Exclude<Choice, 'remove'>) => {
    // Picking takes a while. A form that was reset meanwhile must not get this receipt.
    const { formGeneration } = useAddExpenseStore.getState();

    if ('camera' === source) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        toast.error(t('expense.camera_permission'));
        return;
      }
    }

    const result =
      'camera' === source
        ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    const asset = result.assets?.[0];
    if (result.canceled || !asset || !isCurrentForm(formGeneration)) {
      return;
    }

    const blob = await (await fetch(asset.uri)).blob();
    const type = asset.mimeType ?? (blob.type || 'image/jpeg');
    const size = asset.fileSize ?? blob.size;
    if (size > FILE_SIZE_LIMIT) {
      toast.error(t('expense.file_too_large', { size: FILE_SIZE_LIMIT / 1024 / 1024 }));
      return;
    }

    if (!isCurrentForm(formGeneration)) {
      return;
    }

    const name = asset.fileName ?? `receipt.${type.split('/')[1] ?? 'jpg'}`;
    // The upload's Content-Type comes from the blob, and must match the presigned URL's.
    const file = Object.assign(blob.type ? blob : blob.slice(0, blob.size, type), { name });
    const upload = await uploadReceipt(file, (input) => getUploadUrl.mutateAsync(input));
    if ('uploaded' === upload) {
      setPreview(asset.uri);
      toast.success(t('expense.receipt_uploaded'));
    } else if ('failed' === upload) {
      toast.error(t('expense.receipt_failed'));
    }
  };

  const run = (choice: Choice) => {
    if ('remove' === choice) {
      setPreview(undefined);
      // An empty key saves the edited expense without its receipt; a new one just has none.
      useAddExpenseStore.setState({ fileKey: isEditing ? '' : undefined });
      return;
    }

    pick(choice).catch((error: unknown) => {
      console.warn('Error uploading receipt:', error);
      toast.error(t('expense.receipt_failed'));
    });
  };

  const choices: { choice: Choice; label: string }[] = [
    { choice: 'camera', label: t('expense.take_photo') },
    { choice: 'library', label: t('expense.choose_photo') },
    ...(hasReceipt ? [{ choice: 'remove' as const, label: t('expense.remove_receipt') }] : []),
  ];

  const open = () => {
    if ('web' === Platform.OS) {
      run('library');
      return;
    }

    if ('ios' !== Platform.OS) {
      setSheetOpen(true);
      return;
    }

    const removeIndex = choices.findIndex(({ choice }) => 'remove' === choice);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...choices.map(({ label }) => label), t('common.cancel')],
        cancelButtonIndex: choices.length,
        destructiveButtonIndex: -1 === removeIndex ? undefined : removeIndex,
      },
      (index) => {
        const selected = choices[index];
        if (selected) {
          run(selected.choice);
        }
      },
    );
  };

  const chooseInSheet = (choice: Choice) => {
    choiceAfterClose.current = choice;
    setSheetOpen(false);
  };

  const onSheetDismiss = () => {
    const choice = choiceAfterClose.current;
    choiceAfterClose.current = null;

    if (choice) {
      run(choice);
    }
  };

  return (
    <>
      {hasReceipt || isUploading ? (
        <ListRow
          left={<Icon name={icons.photo} color={colors.tint} size={ICON_SIZE} />}
          title={t('expense.receipt')}
          right={
            isUploading ? (
              <Spinner />
            ) : preview ? (
              <Image source={{ uri: preview }} style={styles.preview} contentFit="cover" />
            ) : (
              <Text color="secondaryLabel">{t('expense.receipt_attached')}</Text>
            )
          }
          disabled={isUploading}
          onPress={open}
          accessibilityLabel={t('expense.change_receipt')}
        />
      ) : (
        <ListRow
          left={<Icon name={icons.photoAdd} color={colors.tint} size={ICON_SIZE} />}
          title={t('expense.add_receipt')}
          action
          onPress={open}
        />
      )}
      {'android' === Platform.OS ? (
        <Sheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onDismiss={onSheetDismiss}
          title={t('expense.receipt')}
          padded={false}
        >
          {choices.map(({ choice, label }) => (
            <ListRow
              key={choice}
              left={
                <Icon
                  name={
                    'camera' === choice
                      ? icons.camera
                      : 'library' === choice
                        ? icons.photo
                        : icons.trash
                  }
                  color={'remove' === choice ? colors.destructive : undefined}
                />
              }
              title={label}
              destructive={'remove' === choice}
              onPress={() => chooseInSheet(choice)}
            />
          ))}
        </Sheet>
      ) : null}
    </>
  );
};

/** Separator inset for the rows next to this one. */
export const RECEIPT_ROW_INSET = rowInset(ICON_SIZE);

const styles = StyleSheet.create({
  preview: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
  },
});
