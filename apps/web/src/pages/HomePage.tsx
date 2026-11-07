import { Feed } from '../features/feed/Feed'

export default function HomePage() {
  return <div className="flex h-full min-h-0 flex-col bg-white">
    <header className="shrink-0 border-b border-[#e2e7e2] px-5 py-4 sm:px-6">
      <h1 className="text-2xl font-bold tracking-wide">ホーム</h1>
    </header>
    <Feed />
  </div>
}
