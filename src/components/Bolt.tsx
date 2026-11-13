/** The app's lightning bolt: the same shape as the Home Screen icon and the opening animation. */
export const BOLT_PATH = "M59 16 L29 54 H47 L41 84 L71 45 H53 Z";

/** Drawn in the surrounding text colour, so it is light on the dark look and dark on the light one. */
export default function Bolt({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d={BOLT_PATH} fill="currentColor" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
    </svg>
  );
}
