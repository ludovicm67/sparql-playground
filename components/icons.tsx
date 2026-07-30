type IconProps = {
  size?: number;
};

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const PlusIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const PencilIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
  </svg>
);

export const TrashIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13M10 11v5M14 11v5" />
  </svg>
);

export const ChevronUpIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m6 14 6-6 6 6" />
  </svg>
);

export const ChevronDownIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m6 10 6 6 6-6" />
  </svg>
);

export const CloseIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const CheckIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m4 12.5 5 5L20 6.5" />
  </svg>
);

export const AlertIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V13M12 16.2v.6" />
  </svg>
);

export const HistoryIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V10h5.5M12 7.5V12l3 2" />
  </svg>
);

export const CloudIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7 18h9.5a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.6-1.2A4 4 0 0 0 7 18Z" />
  </svg>
);

export const ChipIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
    <path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3" />
  </svg>
);

export const SidebarIcon = ({ size = 17 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M10 4.5v15" />
  </svg>
);

export const LayoutIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="5.5" r="2.4" />
    <circle cx="5" cy="17" r="2.4" />
    <circle cx="19" cy="17" r="2.4" />
    <path d="M10.4 7.6 6.4 14.9M13.6 7.6l4 7.3M7.4 17h9.2" />
  </svg>
);

export const QueryIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 6h16M4 12h10M4 18h6" />
    <path d="m15.5 15.5 4.5 4.5M18 13.5v4M16 15.5h4" />
  </svg>
);

export const GraphIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="6" cy="17" r="2.6" />
    <circle cx="18" cy="17" r="2.6" />
    <circle cx="12" cy="6" r="2.6" />
    <path d="m10.5 8.2-3 6.6M13.5 8.2l3 6.6M8.6 17h6.8" />
  </svg>
);

export const FormatIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 5.5h16M7 10h13M7 14.5h9M4 19h16" />
  </svg>
);

export const ShareIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="18" cy="5.5" r="2.6" />
    <circle cx="6" cy="12" r="2.6" />
    <circle cx="18" cy="18.5" r="2.6" />
    <path d="m8.4 10.7 7.2-3.9M8.4 13.3l7.2 3.9" />
  </svg>
);

export const CopyIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15" />
  </svg>
);

export const SpinnerIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)} className="spin">
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);
