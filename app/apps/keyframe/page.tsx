import Link from "next/link";
import { KeyframeLabeler } from "./keyframe-labeler";

export const metadata = {
  title: "原画キーフレーム入力 | Anime Data Create",
};

export default function KeyframePage() {
  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 py-3 md:px-5">
        <header className="flex flex-col gap-2 border-b border-zinc-200 pb-3 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/" className="text-sm font-medium text-zinc-500 hover:text-zinc-950">
              トップへ戻る
            </Link>
            <h1 className="mt-1 text-xl font-semibold tracking-normal md:text-2xl">
              原画キーフレーム入力
            </h1>
          </div>
        </header>

        <KeyframeLabeler />
      </div>
    </main>
  );
}
