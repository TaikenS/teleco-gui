import Link from "next/link";
import React from "react";
import VideoPreview from "@/app/gui/_components/VideoPreview";
import RemoteVideo from "@/app/gui/_components/RemoteVideo";

export default function GuiPage(){
    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            { /* Top bar */ }
            <header className="sticky top-0 border-b bg-white/90 backdrop-blur">
                <div className="mx-auto max-w-6xl px-4 py-3 flex items-center">
                    <span className="font-semibold trackiing-tight">
                        Operator
                    </span>
                    <nav className="ml-auto text-sm">
                        <Link href="/" className="text-slate-600 hover:text-slate-900">
                            Home
                        </Link>
                    </nav>
                </div>
            </header>

            { /* Content */ }
            <main className="mx-auto max-w-6xl p-4 grid gap-4 lg:grid-cols-12">
                {/* Left: controls */}
                <section className="lg:col-span-5 space-y-4">
                    <Card title="Device Setting" subtitle="Camera/Microphone/Share Screen">
                        <Field label="Camera">
                            <select className="w-full rounded-xl border px-3 py-2 text-sm bg-white">
                                <option>Front Camera</option>
                                <option>Room Camera</option>
                            </select>
                        </Field>
                        <Field label="Microphone">
                            <select className="w-full rounded-xl border px-3 py-2 text-sm bg-white">
                                <option>Built-in Mic</option>
                                <option>USB Mic</option>
                            </select>
                        </Field>
                        <div className="pt-2 flex gap-2">
                            <button className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:gb-slate-700">接続</button>
                            <button className="rounded-xl bg-slate-100 px-4py-2 text-sm hover:bg-slate-200">テスト</button>
                        </div>
                    </Card>

                    <Card title="Scene Change" subtitle="preset">
                        <div className="grid grid-cols-2 gap-3">
                            {["標準", "会議", "講義", "発表"].map((name) => (
                                <button key={name} className="rounded-2xl border p-3 text-left hover:shadow-sm">
                                    <div className="font-medium">{name}</div>
                                    <div className="text-xs text-slate-500">Preview</div>
                                </button>
                            ))}
                        </div>
                    </Card>
                </section>

                { /* Right: preview & logs */ }
                <section className="lg:col-span-7 space-y-4">
                    <Card title="Preview" subtitle="Stream Output">
                        <RemoteVideo roomId="room1" />
                    </Card>

                    <Card title="Logs" subtitle="New Event">
                        <ul className="space-y-2 text-sm">
                            {[
                                "waiting for device",
                                "get device list /api/get_configuration",
                            ].map((l, item) => (
                                <li key={item} className="rounded-xl bg-slate-100 px-3 py-2">
                                    {l}
                                </li>
                            ))}
                        </ul>
                    </Card>
                </section>
            </main>
        </div>
    );
}

function Card({
                  title,
                  subtitle,
                  children
} : {
    title: string,
    subtitle?: string;
    children: React.ReactNode
}) {
    return (
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="mb-3">
                <h2 className="text-lg font-semibold leading-none tracking-tight">
                    {title}
                </h2>
                {subtitle &&
                    <p className="text-slate-500 text-sm mt-0.5">
                        {subtitle}
                    </p>}
            </div>
            {children}
        </section>
    )
}

function Field({ label, children }: { label: string, children: React.ReactNode}) {
    return (
        <div className="flex items-center gap-3 py-2">
            <div className="w-20 shrink-0 text-sm text-slate-500">{label}</div>
            <div className="grow">{children}</div>
        </div>
    );
}

function ConfigViewer() {
    // Client Component (SSR不要)
    // ここでは簡易実装 (fetchを直接使用)
    // 本格実装は src/lib/api.tsをimportしてuseEffect/useStateでOK
    return (
        <pre className="rounded-xl bg-slate-100 p-3 text-xs">
            {`{"version": "0.1", "features": ["devicePicker", "preview", "logging"]}`}
        </pre>
    );
}