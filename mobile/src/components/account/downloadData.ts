import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

const FILE_NAME = 'splitpro_data.json';

/**
 * Saves the export like the web does: a file download on web, the share sheet on a phone. Resolves
 * `false` when the device can't share files.
 */
export const shareDataExport = async (data: unknown, dialogTitle: string) => {
  const json = JSON.stringify(data, null, 2);

  if ('web' === Platform.OS) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = FILE_NAME;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }

  if (!(await Sharing.isAvailableAsync())) {
    return false;
  }

  const file = new File(Paths.cache, FILE_NAME);
  file.create({ overwrite: true });
  await file.write(json);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle,
  });

  return true;
};
