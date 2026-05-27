import { CloudCheckIcon } from "@phosphor-icons/react";

interface Props {
  title: string;
  desc: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, desc, action }: Props) {
  return (
    <div className="rounded-[2.5rem] bg-white border border-slate-200/60 p-12 text-center shadow-[0_20px_40px_-15px_rgba(0,0,0,0.04)]">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-neutral-100 mb-5">
        <CloudCheckIcon size={26} weight="duotone" className="text-neutral-700" />
      </div>
      <h3 className="text-base font-semibold tracking-tight mb-1.5">{title}</h3>
      <p className="text-[13px] text-neutral-500 max-w-md mx-auto leading-relaxed">{desc}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
