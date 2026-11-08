import React from 'react';
import { Button } from './ui/button';
import { Download } from 'lucide-react';
import { AppDrawer } from './ui/drawer';
import { AppBetaLinks } from './AppBeta';

const InstallApp: React.FC = () => {
  const [isStandalone, setIsStandalone] = React.useState(false);

  function isAppStandalone() {
    // For iOS
    if ('standalone' in navigator) {
      return (navigator as unknown as { standalone: boolean }).standalone;
    }
    // For Android
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return true;
    }
    // Fallback for browsers that don't support the above methods
    return false;
  }

  React.useEffect(() => {
    if (isAppStandalone()) {
      setIsStandalone(true);
    }
  }, []);

  if (isStandalone) {
    return null;
  }

  return (
    <>
      <AppDrawer
        trigger={
          <Button className="w-[250px]">
            <Download className="mr-2 h-5 w-5 text-black" />
            Download App
          </Button>
        }
        leftAction="Close"
        title="Download App"
        className="h-[70vh]"
        shouldCloseOnAction
      >
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <p>The native app is in beta. Try it early and tell me what breaks.</p>
            <AppBetaLinks />
          </div>

          <div className="flex flex-col gap-4 border-t pt-6">
            <p>Or add SplitPro to your home screen from the browser.</p>

            <p>
              If you are using iOS, checkout this{' '}
              <a
                className="text-cyan-500 underline"
                href="https://youtube.com/shorts/MQHeLOjr350"
                target="_blank"
              >
                video
              </a>
            </p>

            <p>
              If you are using Android, checkout this{' '}
              <a
                className="text-cyan-500 underline"
                href="https://youtube.com/shorts/04n7oKGzgOs"
                target="_blank"
              >
                Video
              </a>
            </p>
          </div>
        </div>
      </AppDrawer>

      <p>or</p>
    </>
  );
};

export default InstallApp;
