import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  canInstall: boolean;
  isInstalled: boolean;
  isIOS: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();

function detectInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

const isIOS =
  typeof navigator !== 'undefined' &&
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window as unknown as { MSStream?: unknown }).MSStream;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let snapshot: InstallState = {
  canInstall: false,
  isInstalled: detectInstalled(),
  isIOS,
};

function emit() {
  snapshot = {
    canInstall: Boolean(deferredPrompt),
    isInstalled: snapshot.isInstalled,
    isIOS,
  };
  for (const listener of listeners) listener();
}

// Listeners are registered at module load so the browser's early
// `beforeinstallprompt` event is never lost before Settings is opened.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    snapshot = { ...snapshot, isInstalled: true };
    emit();
  });
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): InstallState {
  return snapshot;
}

export function usePWAInstall() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const promptInstall = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') {
      snapshot = { ...snapshot, isInstalled: true };
    }
    emit();
    return outcome === 'accepted';
  };

  return {
    canInstall: state.canInstall,
    isInstalled: state.isInstalled,
    isIOS: state.isIOS,
    promptInstall,
  };
}
