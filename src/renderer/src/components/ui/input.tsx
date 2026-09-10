import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon, type IconName } from "./icon";

type InputSize = "xs" | "sm";

// `size` is re-typed away from the native numeric attribute (character width),
// which this design system never uses, to the same scale as `Select`.
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  icon?: IconName;
  ref?: Ref<HTMLInputElement>;
  size?: InputSize;
};

// Same scale as `Select`, so an input and a dropdown sitting in the same
// toolbar line up without either one being nudged by hand.
const sizes: Record<InputSize, string> = {
  xs: "h-7 px-2 text-xs",
  sm: "h-9 px-3 text-sm",
};

const iconOffsets: Record<InputSize, { icon: string; padding: string }> = {
  xs: { icon: "left-2", padding: "pl-7" },
  sm: { icon: "left-2.5", padding: "pl-8" },
};

export function Input({ className, icon, ref, size = "sm", ...props }: InputProps) {
  return (
    <div className="relative">
      {icon ? (
        <Icon
          className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-subtle", iconOffsets[size].icon)}
          name={icon}
        />
      ) : null}
      <input
        className={cn(
          "w-full rounded-lg border border-border bg-surface text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger/80 aria-invalid:focus-visible:ring-danger/80",
          sizes[size],
          icon && iconOffsets[size].padding,
          className,
        )}
        ref={ref}
        {...props}
      />
    </div>
  );
}
