import { Link } from 'react-router'
import { Feed } from '../features/feed/Feed'

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

      <Feed />
    </>
  )
}
