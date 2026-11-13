import { BOLT_PATH } from "./Bolt";

/** The opening screen: a bolt strikes in from the right, the screen flashes, the bolt blinks out and returns. */
export default function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading Voice Notes" data-testid="splash">
      <div className="splash-flash" />
      <svg className="splash-bolt" width="132" height="132" viewBox="0 0 100 100" aria-hidden="true">
        <path d={BOLT_PATH} fill="#ffffff" stroke="#ffffff" strokeWidth="5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
