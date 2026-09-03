import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "@renderer/lib/utils";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "live";
type ButtonSize = "xs" | "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string | undefined;
  ref?: Ref<HTMLButtonElement>;
  size?: ButtonSize;
  toggled?: boolean;
  variant?: ButtonVariant;
};

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground shadow-surface hover:bg-primary-hover active:bg-primary-hover/80",
  secondary: "bg-secondary text-secondary-foreground shadow-surface hover:bg-muted active:bg-muted/80",
  outline: "border border-border bg-transparent text-foreground hover:border-primary hover:bg-muted active:bg-muted/80",
  ghost: "text-foreground hover:bg-muted active:bg-muted/80",
  danger: "bg-danger text-danger-foreground shadow-surface hover:bg-danger/90 active:bg-danger/75",
  live: "bg-success text-white shadow-surface hover:bg-success/90 active:bg-success/75",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2 text-xs gap-1",
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-base gap-2",
};

export function Button({
  children,
  className,
  disabled,
  loading = false,
  loadingLabel,
  ref,
  size = "sm",
  toggled = false,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const disabledEffective = disabled || loading;
  return (
    <button
      aria-busy={loading || undefined}
      aria-pressed={toggled || undefined}
      className={cn(
        "relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        sizes[size],
        toggled && "ring-2 ring-ring",
        className,
      )}
      disabled={disabledEffective}
      ref={ref}
      type={type}
      {...props}
    >
      <span className={cn("inline-flex min-w-0 items-center justify-center gap-2", loading && "invisible")}>
        {children}
      </span>
      {loading ? (
        <>
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 h-2 w-24 max-w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-current/25"
          >
            <span className="wa-button-loading-shimmer block h-full w-1/2 rounded-full bg-current/60" />
          </span>
          {loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
        </>
      ) : null}
    </button>
  );
}
