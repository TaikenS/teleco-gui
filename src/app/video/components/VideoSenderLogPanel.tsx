type Props = {
  log: string[];
};

export default function VideoSenderLogPanel({ log }: Props) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold">ログ</h2>
      <div className="max-h-48 space-y-1 overflow-auto text-xs text-slate-700">
        {log.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  );
}
