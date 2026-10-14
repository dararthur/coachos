import type { AvatarStyle } from "@/domain/profile";

const SKIN = "#b9b2a6";
const FIGURE = "#6a6f76";

/** Silhouette d'avatar (femme, homme, neutre) en deux tons sur la tuile crème : même gabarit que les photos, aucun trait de visage. */
export function Silhouette({ style, className = "" }: { style: AvatarStyle; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={`bg-sunken ${className}`}>
      {style === "woman" && (
        <>
          <path d="M9.5 26C9.5 11 16 5 24 5s14.5 6 14.5 21c0 5 1.5 8 3.5 11H6c2-3 3.5-6 3.5-11Z" fill={FIGURE} />
          <path d="M7 48c0-9 7-14 17-14s17 5 17 14Z" fill={FIGURE} />
          <rect x="20.5" y="28" width="7" height="8" rx="2" fill={SKIN} />
          <ellipse cx="24" cy="20.5" rx="8.4" ry="9.8" fill={SKIN} />
          <path d="M15.4 20C15.6 12.2 20 9.6 24 9.6s8.4 2.6 8.6 10.4C29.4 15 18.6 15 15.4 20Z" fill={FIGURE} />
        </>
      )}
      {style === "man" && (
        <>
          <path d="M2 48c0-10 8-15 22-15s22 5 22 15Z" fill={FIGURE} />
          <rect x="19.5" y="25" width="9" height="11" rx="2.5" fill={SKIN} />
          <rect x="15.8" y="9.5" width="16.4" height="19" rx="7" fill={SKIN} />
          <path d="M15.4 17.5C15.4 9 19.6 6.2 24 6.2s8.6 2.8 8.6 11.3C30 13.6 18 13.6 15.4 17.5Z" fill={FIGURE} />
        </>
      )}
      {style === "neutral" && (
        <>
          <path d="M5 48c0-9.5 8-15 19-15s19 5.5 19 15Z" fill={FIGURE} />
          <rect x="20" y="26" width="8" height="10" rx="2.5" fill={SKIN} />
          <circle cx="24" cy="19" r="9" fill={SKIN} />
        </>
      )}
    </svg>
  );
}
