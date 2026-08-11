import { Button } from "@openmeld/ui/components/button";
import { OpenMeldLogo } from "../components/openmeld-logo";

/**
 * The launch first-screen: the glowing OpenMeld wordmark centered, with the
 * expansion + tagline, before the app fades in. The logo's reflection band
 * follows the cursor, so it's alive the moment the window opens.
 */
type SplashProps = {
  leaving: boolean;
  onGoHome: () => void;
};

export function Splash({ leaving, onGoHome }: SplashProps) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground transition-opacity duration-500"
      style={{ opacity: leaving ? 0 : 1 }}
    >
      <div className="relative flex flex-col items-center">
        <OpenMeldLogo className="text-foreground" size={26} />
        <div className="mt-7 text-center">
          <p className="text-muted-foreground text-xs uppercase tracking-[0.34em]">
            Agent · Transport · System
          </p>
          <p className="mx-auto mt-4 max-w-xs text-muted-foreground text-sm leading-relaxed">
            Connect any agents running on different machines through the cloud.
          </p>
        </div>
        <div className="absolute top-full mt-7">
          <Button className="min-w-32 px-4" onClick={onGoHome} type="button">
            Go Home
          </Button>
        </div>
      </div>
    </div>
  );
}
