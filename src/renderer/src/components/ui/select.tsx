import type { Ref, SelectHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";
import { Icon } from "./icon";

export type SelectOption = { disabled?: boolean; label: string; value: string };

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  options: SelectOption[];
  placeholder?: string;
  ref?: Ref<HTMLSelectElement>;
  size?: "xs" | "sm" | "md";
};

const sizes: Record<NonNullable<SelectProps["size"]>, string> = {
  xs: "h-7 text-xs pl-2 pr-6",
  sm: "h-9 text-sm pl-3 pr-8",
  md: "h-10 text-sm pl-3 pr-8",
};

/**
 * A native <select> styled to match the design system, not a Dropdown-backed
 * custom listbox — WorshipApp's selects (books, chapters, versions, displays)
 * are short, unsearched lists where the native control's OS-level accessibility
 * and keyboard handling is strictly better than reimplementing it.
 */
export function Select({ className, options, placeholder, ref, size = "sm", ...props }: SelectProps) {
  return (
    <div className="relative inline-block">
      <select
        className={cn(
          "appearance-none rounded-lg border border-border bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
          sizes[size],
          className,
        )}
        ref={ref}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((opt) => (
          <option disabled={opt.disabled} key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <Icon
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-subtle"
        name="chevronDown"
      />
    </div>
  );
}
