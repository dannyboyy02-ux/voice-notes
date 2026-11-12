/** The opening screen: a bolt strikes in from the right, the screen flashes, the bolt blinks out and returns. */
export default function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading Voice Notes" data-testid="splash">
      <div className="splash-flash" />
      <svg className="splash-bolt" width="132" height="132" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M59 16 L29 54 H47 L41 84 L71 45 H53 Z" fill="#ffffff" stroke="#ffffff" strokeWidth="5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
