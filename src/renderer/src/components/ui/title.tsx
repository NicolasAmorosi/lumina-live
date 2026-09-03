import type { HTMLAttributes, LabelHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

type TitleProps = HTMLAttributes<HTMLHeadingElement> & { as?: "h1" | "h2" | "h3" };

const sizes: Record<NonNullable<TitleProps["as"]>, string> = {
  h1: "text-xl font-semibold",
  h2: "text-sm font-semibold uppercase tracking-wide text-subtle",
  h3: "text-sm font-medium",
};

export function Title({ as = "h2", className, ...props }: TitleProps) {
  const Component = as;
  return <Component className={cn(sizes[as], className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs font-medium text-muted-foreground", className)} {...props} />;
}
