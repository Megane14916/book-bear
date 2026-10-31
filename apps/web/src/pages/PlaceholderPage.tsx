type PlaceholderPageProps = {
  title: string
  description: string
}

export default function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <section className="pt-4">
      <p className="mb-4 text-[11px] font-extrabold tracking-[0.16em] text-[#538063]">COMING SOON</p>
      <h1 className="text-3xl leading-relaxed font-bold md:text-[43px]">{title}</h1>
      <p className="mt-3 mb-7 leading-8 text-[#66776a]">{description}</p>
      <div className="rounded-[20px] border border-[#e7ebe5] bg-white px-6 py-10 text-center">
        <div className="mx-auto mb-4 grid h-[54px] w-[54px] place-items-center rounded-2xl bg-[#eef4ec] text-[28px] text-[#4c775a]" aria-hidden="true">
          ✦
        </div>
        <p className="mb-2 font-extrabold">画面を準備中です</p>
        <p className="text-[13px] leading-7 text-[#78827a]">
          URLを使った画面遷移の土台ができました。
        </p>
      </div>
    </section>
  )
}
