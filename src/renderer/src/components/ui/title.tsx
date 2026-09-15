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

/** `Label`'s typography without the `<label>` semantics — for text that names
 *  something that is not a form control (a `progressbar`, a group), pointed at
 *  with `aria-labelledby`. */
export function Caption({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-xs font-medium text-muted-foreground", className)} {...props} />;
}

/** A form field's caption. The association is the call site's job — pass
 *  `htmlFor`, or wrap the control — because a primitive cannot know which
 *  control it names. Anything that is NOT naming a form control wants plain
 *  text, not this. */
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    /* eslint-disable-next-line jsx-a11y/label-has-associated-control -- the
       rule reads one file at a time and cannot see the `htmlFor` a caller
       spreads in. */
    <label className={cn("text-xs font-medium text-muted-foreground", className)} {...props} />
  );
}
