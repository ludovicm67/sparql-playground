type Props = {
  size?: number;
  className?: string;
};

/** A tiny RDF graph: one subject linked to two objects. */
const GraphMark: React.FC<Props> = ({ size = 22, className }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M5.5 8.5 18.5 5.5M5.5 8.5 14 17.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      opacity="0.5"
    />
    <circle cx="5.5" cy="8.5" r="2.9" fill="currentColor" />
    <circle cx="18.5" cy="5.5" r="2.2" fill="currentColor" opacity="0.72" />
    <circle cx="14" cy="17.5" r="2.2" fill="currentColor" opacity="0.72" />
  </svg>
);

export default GraphMark;
