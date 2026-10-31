import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <section className="pt-10 text-center">
      <p className="mb-3 text-sm font-bold tracking-widest text-forest">404</p>
      <h1 className="mb-3 text-2xl font-bold">ページが見つかりません</h1>
      <p className="mb-8 text-sm leading-7 text-[#66776a]">
        URLが正しいか確認してください。
      </p>
      <Link
        to="/"
        className="inline-flex min-h-11 items-center rounded-full bg-forest px-6 py-3 text-sm font-bold text-white hover:bg-forest-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
      >
        ホームへ戻る
      </Link>
    </section>
  )
}
