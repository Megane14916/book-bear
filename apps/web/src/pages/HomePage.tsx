import { Link } from 'react-router'

export default function HomePage() {
  return (
    <>
      <section className="rounded-3xl bg-mist px-6 py-9 md:px-12 md:py-12">
        <p className="mb-4 text-[11px] font-extrabold tracking-[0.16em] text-[#538063]">
          YOUR READING JOURNEY
        </p>
        <h1 className="text-[30px] leading-[1.45] font-bold tracking-wide md:text-[43px]">
          本の中に、
          <br />
          あなたの栞を。
        </h1>
        <p className="mt-4 mb-7 text-sm leading-8 text-[#526356]">
          心に残ったページと、そのときの気持ちを記録する。
          <br className="hidden sm:block" />
          小さな栞から、読書の思い出をつなげよう。
        </p>
        <Link
          to="/search"
          className="inline-flex min-h-11 items-center rounded-full bg-forest px-6 py-3 text-sm font-bold text-white hover:bg-forest-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          本を探してみる <span className="ml-3" aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold">みんなの栞</h2>
          <span className="text-[11px] text-[#8b958d]">これから表示されます</span>
        </div>
        <div className="rounded-[20px] border border-[#e7ebe5] bg-white px-6 py-10 text-center">
          <div className="mx-auto mb-4 grid h-[54px] w-[54px] place-items-center rounded-2xl bg-[#eef4ec] text-[28px] text-[#4c775a]" aria-hidden="true">
            ▤
          </div>
          <p className="mb-2 font-extrabold">栞はまだありません</p>
          <p className="text-[13px] leading-7 text-[#78827a]">
            投稿が集まると、ここに新しい栞が表示されます。
          </p>
        </div>
      </section>
    </>
  )
}
