type Props = {
  log: string[];
};

export default function AudioSenderLogPanel({ log }: Props) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <h2 className="text-sm font-semibold mb-2">ログ</h2>
      <div className="max-h-48 overflow-auto text-xs text-slate-700 space-y-1">
        {log.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  );
}
