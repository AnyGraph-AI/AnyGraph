export function AnythingGraphLogo({ size = 28 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <defs>
        <filter id="anythinggraph-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#anythinggraph-glow)">
        <line x1="50" y1="12" x2="15" y2="82" stroke="#7ec8e3" strokeWidth="2.5" />
        <line x1="50" y1="12" x2="85" y2="82" stroke="#7ec8e3" strokeWidth="2.5" />
        <line x1="15" y1="82" x2="85" y2="82" stroke="#7ec8e3" strokeWidth="2.5" />
        <line x1="50" y1="12" x2="38" y2="52" stroke="#7ec8e3" strokeWidth="1.5" />
        <line x1="38" y1="52" x2="15" y2="82" stroke="#7ec8e3" strokeWidth="1.5" />
        <line x1="38" y1="52" x2="85" y2="82" stroke="#7ec8e3" strokeWidth="1.5" />
        <circle cx="50" cy="12" r="4" fill="#7ec8e3" />
        <circle cx="15" cy="82" r="4" fill="#7ec8e3" />
        <circle cx="85" cy="82" r="4" fill="#7ec8e3" />
        <circle cx="38" cy="52" r="3" fill="#7ec8e3" />
      </g>
    </svg>
  );
}
