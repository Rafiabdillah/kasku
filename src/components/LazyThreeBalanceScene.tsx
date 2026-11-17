import { lazy, Suspense } from 'react';
import type { ThreeSceneMetrics } from './ThreeBalanceScene';

const ThreeBalanceScene = lazy(() =>
  import('./ThreeBalanceScene').then((m) => ({ default: m.ThreeBalanceScene })),
);

interface LazyThreeBalanceSceneProps {
  metrics: ThreeSceneMetrics;
  fullScreen?: boolean;
  onToggleFullScreen?: () => void;
}

function SceneSkeleton({ fullScreen }: { fullScreen?: boolean }) {
  return (
    <div
      className={
        fullScreen
          ? 'w-full h-[calc(100vh-64px)] min-h-[540px] bg-[#EFECE5]'
          : 'w-full h-[380px] lg:h-[430px] rounded-xl border border-[#E5E2DC] bg-[#EFECE5]'
      }
      aria-hidden="true"
    >
      <div className="h-full flex items-center justify-center text-xs font-medium text-[#57534E]">
        Memuat visualisasi 3D...
      </div>
    </div>
  );
}

export function LazyThreeBalanceScene(props: LazyThreeBalanceSceneProps) {
  return (
    <Suspense fallback={<SceneSkeleton fullScreen={props.fullScreen} />}>
      <ThreeBalanceScene {...props} />
    </Suspense>
  );
}
