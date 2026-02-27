import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, id, className = "", ...props }, ref) => {
    return (
      <div>
        {label && (
          <label
            htmlFor={id}
            className="mb-2 block text-xs font-bold uppercase text-text-secondary"
          >
            {label}
          </label>
        )}
        <input
          id={id}
          ref={ref}
          className={`w-full rounded bg-background-tertiary px-3 py-2 text-text-primary outline-none ring-1 ring-transparent transition focus:ring-brand ${className}`}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-status-dnd">{error}</p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
