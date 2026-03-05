import type { ButtonHTMLAttributes, MouseEventHandler, ReactNode } from "react";

type ActionTone =
  | "primary"
  | "secondary"
  | "success"
  | "info"
  | "violet"
  | "amber";

const ACTION_TONE_CLASS: Record<ActionTone, string> = {
  primary: "bg-slate-900 text-white",
  secondary: "bg-slate-100",
  success: "bg-emerald-600 text-white",
  info: "bg-blue-600 text-white",
  violet: "bg-violet-600 text-white",
  amber: "bg-amber-600 text-white",
};

export type ActionButtonProps = {
  label: ReactNode;
  busyLabel?: ReactNode;
  busy?: boolean;
  tone?: ActionTone;
  className?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className">;

export function ActionButton({
  label,
  busyLabel,
  busy = false,
  tone = "secondary",
  className = "",
  onClick,
  type = "button",
  ...buttonProps
}: ActionButtonProps) {
  const toneClass = ACTION_TONE_CLASS[tone];
  const nextLabel = busy && busyLabel != null ? busyLabel : label;

  return (
    <button
      type={type}
      onClick={onClick}
      className={`action-button ${toneClass} text-sm ${className}`.trim()}
      data-busy={busy ? "1" : undefined}
      aria-busy={busy || undefined}
      {...buttonProps}
    >
      {nextLabel}
    </button>
  );
}

type ActionControlProps = {
  reason: ReactNode;
  isReady: boolean;
  button: ActionButtonProps;
};

export function ActionControl({ reason, isReady, button }: ActionControlProps) {
  return (
    <div className="action-button-wrap">
      <ActionButton {...button} />
      <p className={`button-reason ${isReady ? "is-ready" : "is-disabled"}`}>
        {reason}
      </p>
    </div>
  );
}
