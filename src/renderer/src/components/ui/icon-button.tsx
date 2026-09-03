import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "@renderer/lib/utils";

type IconButtonVariant = "primary" | "outline" | "ghost";
type IconButtonSize = "xs" | "sm" | "md";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  size?: IconButtonSize;
  toggled?: boolean;
  variant?: IconButtonVariant;
};

const variants: Record<IconButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  outline: "border border-border bg-transparent text-foreground hover:border-primary hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
};

const sizes: Record<IconButtonSize, string> = {
  xs: "size-6",
  sm: "size-9",
  md: "size-10",
};

export function IconButton({
  className,
  ref,
  size = "sm",
  toggled = false,
  type = "button",
  variant = "outline",
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-pressed={toggled || undefined}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        sizes[size],
        toggled && "bg-primary text-primary-foreground",
        className,
      )}
      ref={ref}
      type={type}
      {...props}
    />
  );
}
