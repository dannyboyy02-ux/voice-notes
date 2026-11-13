/** The small line icons used on round buttons at the top of a screen. Drawn in the surrounding text colour. */
const base = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

/** A magnifying glass: search. */
export const SearchIcon = () => <svg {...base}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.8-3.8" /></svg>;

/** A cloud with an arrow going up into it: bring an audio file in. */
export const ImportIcon = () => (
  <svg {...base}>
    <path d="M7.5 18.5H7a4.5 4.5 0 0 1-.9-8.9 6 6 0 0 1 11.7-1.1A4.6 4.6 0 0 1 17.5 18.5H16.5" />
    <path d="M12 21v-8M8.8 15.6L12 12.4l3.2 3.2" />
  </svg>
);

/** Three dots: more choices. */
export const MoreIcon = () => (
  <svg {...base} stroke="none" fill="currentColor">
    <circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" />
  </svg>
);

/** A chevron pointing left: go back. */
export const BackIcon = () => <svg {...base}><path d="M15 5l-7 7 7 7" /></svg>;
