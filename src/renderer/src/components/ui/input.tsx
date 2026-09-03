import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon, type IconName } from "./icon";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  icon?: IconName;
  ref?: Ref<HTMLInputElement>;
};

export function Input({ className, icon, ref, ...props }: InputProps) {
  return (
    <div className="relative">
      {icon ? (
        <Icon className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" name={icon} />
      ) : null}
      <input
        className={cn(
          "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger/80 aria-invalid:focus-visible:ring-danger/80",
          icon && "pl-8",
          className,
        )}
        ref={ref}
        {...props}
      />
    </div>
  );
}
