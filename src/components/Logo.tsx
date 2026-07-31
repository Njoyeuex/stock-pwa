export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <path d="M15 10 L50 38 L85 10 L85 32 L50 58 L15 32 Z" fill="#0d1a8f" />
      <path
        d="M8 28 L50 58 L92 28 L92 52 L68 70 L68 90 L56 90 L56 64 L50 68 L44 64 L44 90 L32 90 L32 70 L8 52 Z"
        fill="#e31e24"
      />
      <rect x="42" y="92" width="16" height="6" rx="1" fill="#0d1a8f" />
    </svg>
  );
}
