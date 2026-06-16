import Image from "next/image";

type Size = "sm" | "md" | "lg";

const DIMS: Record<Size, { mark: number; font: string; gap: string }> = {
  sm: { mark: 30, font: "text-[22px]", gap: "gap-2" },
  md: { mark: 40, font: "text-2xl", gap: "gap-2.5" },
  lg: { mark: 88, font: "", gap: "" },
};

/**
 * The MailPoppy brand lockup — the "M" mark next to the crimson "MailPoppy"
 * wordmark (Crimson Navy design, ported from the mobile Logo component). At `lg`
 * the mark sits in a rounded surface tile (used on the login screen) and the
 * wordmark is omitted.
 */
export function Logo({
  size = "md",
  showWordmark = true,
  className = "",
}: {
  size?: Size;
  showWordmark?: boolean;
  className?: string;
}) {
  const d = DIMS[size];

  if (size === "lg") {
    return (
      <div
        className={`bg-surface-container border-hairline flex h-32 w-32 items-center justify-center overflow-hidden rounded-3xl border ${className}`}
        aria-label="MailPoppy"
      >
        <Image src="/logo-mark.png" alt="" width={88} height={88} priority />
      </div>
    );
  }

  return (
    <div className={`flex items-center ${d.gap} ${className}`} aria-label="MailPoppy">
      <Image src="/logo-mark.png" alt="" width={d.mark} height={d.mark} priority />
      {showWordmark && (
        <span className={`text-primary font-bold tracking-tight ${d.font}`}>MailPoppy</span>
      )}
    </div>
  );
}
