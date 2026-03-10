import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function SectionCard({
  title,
  subtitle,
  children,
}: SectionCardProps) {
  return (
    <section className="teleco-card rounded-2xl border bg-white p-4 shadow-sm md:p-5">
      <div className="mb-3">
        <h2 className="text-lg font-semibold leading-none tracking-tight text-slate-900">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
