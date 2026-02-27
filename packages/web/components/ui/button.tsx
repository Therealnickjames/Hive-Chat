import { forwardRef } from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: "brand" | "ghost";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ loading, variant = "brand", children, className = "", disabled, ...props }, ref) => {
    const base =
      "rounded px-4 py-2.5 font-medium transition disabled:opacity-50";
    const variants = {
      brand: "bg-brand text-background-floating hover:bg-brand-hover",
      ghost: "text-text-secondary hover:text-text-primary hover:bg-background-primary",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${base} ${variants[variant]} ${className}`}
        {...props}
      >
        {loading ? "Loading..." : children}
      </button>
    );
  },
);

Button.displayName = "Button";
