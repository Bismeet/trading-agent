"use client";

import React from "react";

interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "success" | "danger" | "subtle";
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  icon?: React.ReactNode;
}

export function GlassButton({
  children,
  variant = "secondary",
  size = "md",
  busy = false,
  icon,
  disabled,
  className = "",
  ...props
}: GlassButtonProps) {
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-base",
  }[size];

  const variantClasses = {
    primary: "glass-btn-primary",
    secondary: "",
    success: "glass-btn-success",
    danger: "glass-btn-danger",
    subtle: "bg-white/30 hover:bg-white/60 border-white/40 text-inksoft hover:text-ink shadow-none",
  }[variant];

  return (
    <button
      disabled={disabled || busy}
      className={`glass-btn ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {busy ? (
        <span className="inline-block animate-spin h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full mr-1" />
      ) : (
        icon && <span className="inline-flex shrink-0">{icon}</span>
      )}
      <span>{children}</span>
    </button>
  );
}

export default GlassButton;
