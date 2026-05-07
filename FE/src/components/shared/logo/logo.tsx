interface LogoProps {
  size?: 'sm' | 'md';
}

export function Logo({ size = 'md' }: LogoProps) {
  const textClass = size === 'sm' ? 'text-base font-semibold' : 'text-lg font-semibold';

  return (
    <div className="flex items-center gap-2">
      <svg
        width={size === 'sm' ? 20 : 24}
        height={size === 'sm' ? 20 : 24}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <rect x="1" y="8" width="3" height="8" rx="1.5" fill="#4A6741" />
        <rect x="6" y="5" width="3" height="14" rx="1.5" fill="#4A6741" />
        <rect x="11" y="2" width="3" height="20" rx="1.5" fill="#4A6741" />
        <rect x="16" y="5" width="3" height="14" rx="1.5" fill="#4A6741" />
        <rect x="21" y="8" width="3" height="8" rx="1.5" fill="#4A6741" />
      </svg>
      <span className={`${textClass} text-[#4A6741]`}>SpeakUp</span>
    </div>
  );
}
