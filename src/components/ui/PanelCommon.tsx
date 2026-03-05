import type { ComponentPropsWithoutRef, ReactNode } from "react";

type PanelBoxProps = {
  children: ReactNode;
  className?: string;
};

export function PanelBox({ children, className = "space-y-3" }: PanelBoxProps) {
  return (
    <div className={`rounded-xl border bg-white p-3 ${className}`.trim()}>
      {children}
    </div>
  );
}

type PanelFieldProps = {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
};

export function PanelField({
  label,
  children,
  className = "",
  labelClassName = "text-sm",
}: PanelFieldProps) {
  return (
    <label className={`text-slate-700 ${labelClassName} ${className}`.trim()}>
      {label}
      {children}
    </label>
  );
}

export function PanelInput(props: ComponentPropsWithoutRef<"input">) {
  const { className = "", ...rest } = props;
  return (
    <input
      className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm ${className}`.trim()}
      {...rest}
    />
  );
}

export function PanelSelect(props: ComponentPropsWithoutRef<"select">) {
  const { className = "", ...rest } = props;
  return (
    <select
      className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm ${className}`.trim()}
      {...rest}
    />
  );
}

type PanelInfoProps = {
  children: ReactNode;
  className?: string;
};

export function PanelInfo({ children, className = "" }: PanelInfoProps) {
  return (
    <p
      className={`rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-700 ${className}`.trim()}
    >
      {children}
    </p>
  );
}

type PanelLogProps = {
  children: ReactNode;
  className?: string;
};

export function PanelLog({ children, className = "" }: PanelLogProps) {
  return (
    <pre
      className={`max-h-48 w-full overflow-auto rounded-xl border bg-slate-50 p-2 text-[11px] text-slate-700 ${className}`.trim()}
    >
      {children}
    </pre>
  );
}

export function PanelDivider() {
  return <div className="border-t pt-3" />;
}
