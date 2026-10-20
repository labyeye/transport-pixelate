import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 border-2 border-black shadow-[3px_3px_0px_#0a0a0a] hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0px_#0a0a0a] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_#0a0a0a] disabled:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 border-2 border-black shadow-[3px_3px_0px_#0a0a0a] hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0px_#0a0a0a] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_#0a0a0a] disabled:shadow-none",
        outline:
          "bg-background hover:bg-accent hover:text-accent-foreground border-2 border-black shadow-[3px_3px_0px_#0a0a0a] hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0px_#0a0a0a] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_#0a0a0a] disabled:shadow-none",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 border-2 border-black shadow-[3px_3px_0px_#0a0a0a] hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0px_#0a0a0a] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_#0a0a0a] disabled:shadow-none",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3",
        lg: "h-11 rounded-lg px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
export { Button, buttonVariants };
