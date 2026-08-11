import { Icon } from "./icon";

export function Brand({
  label = "Base Cafe",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <span className="bc-brand" aria-label={label}>
      <span className="bc-brand__mark">
        <Icon name="coffee" size={compact ? 26 : 32} />
      </span>
      {compact ? null : <span className="bc-brand__text">{label}</span>}
    </span>
  );
}
