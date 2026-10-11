import React from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { type File, FileUp, ImagePlus, Image as ImageUploaded } from 'lucide-react';
import { uploadReceipt, useAddExpenseStore } from '~/store/addStore';
import { api } from '~/utils/api';
import { FILE_SIZE_LIMIT } from '~/lib/constants';
import { toast } from 'sonner';

const getImgHeightAndWidth = (file: File) => {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = (error) => {
      reject(error);
    };
  });
};

export const UploadFile: React.FC = () => {
  const hasReceipt = useAddExpenseStore((s) => s.isFileUploading || !!s.fileKey);

  const getUploadUrl = api.user.getUploadUrl.useMutation();

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;

    const file = files?.[0];

    if (!file) return;

    if (file.size > FILE_SIZE_LIMIT) {
      toast.error(`File should be less than ${FILE_SIZE_LIMIT / 1024 / 1024}MB`);
      return;
    }

    const { height, width } = await getImgHeightAndWidth(file);
    console.log('height:', height, 'width:', width);

    try {
      const result = await uploadReceipt(file, (input) => getUploadUrl.mutateAsync(input));
      if ('uploaded' === result) {
        toast.success('File uploaded successfully');
      } else if ('failed' === result) {
        toast.error('Failed to upload file');
      }
    } catch (error) {
      console.error('Error getting upload url:', error);
      toast.error(`Error uploading file`);
    }
  };

  return (
    <div>
      <Label htmlFor="picture">
        {hasReceipt ? (
          <ImageUploaded className="h-6 w-6 text-primary" />
        ) : (
          <ImagePlus className="h-6 w-6 text-gray-300" />
        )}
        <Input
          onChange={handleFileChange}
          id="picture"
          type="file"
          accept="image/*"
          className="hidden"
        />
      </Label>
    </div>
  );
};

export default UploadFile;
