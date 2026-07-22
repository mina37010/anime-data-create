import Link from "next/link";
import { apps } from "./apps";

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10 md:px-10">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-8">
          <p className="text-sm font-medium text-zinc-500">Anime Data Create</p>
          <h1 className="text-3xl font-semibold tracking-normal text-zinc-950 md:text-4xl">
            入力作業用アプリ
          </h1>
          <p className="max-w-2xl text-base leading-7 text-zinc-600">
            制作用データの整理・入力ツールをまとめるためのトップページです。
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {apps.map((app) => (
            <Link
              key={app.href}
              href={app.href}
              className="group flex min-h-40 flex-col justify-between rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-400 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold tracking-normal text-zinc-950">
                    {app.name}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-zinc-600">{app.description}</p>
                </div>
                <span className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                  使用可
                </span>
              </div>
              <span className="mt-6 text-sm font-medium text-zinc-900 group-hover:underline">
                開く
              </span>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
