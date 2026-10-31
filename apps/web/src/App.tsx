import { useState } from 'react'

type Tab = 'home' | 'search' | 'create' | 'library' | 'me'

const tabs: { id: Tab; label: string; symbol: string }[] = [
  { id: 'home', label: 'ホーム', symbol: '⌂' },
  { id: 'search', label: '検索', symbol: '⌕' },
  { id: 'create', label: '投稿', symbol: '＋' },
  { id: 'library', label: '本棚', symbol: '▤' },
  { id: 'me', label: 'マイページ', symbol: '◯' },
]

const pageDetails: Record<Exclude<Tab, 'home'>, { title: string; description: string }> = {
  search: {
    title: '本を探す',
    description: '書名やISBNから本を探す画面を、次に実装します。',
  },
  create: {
    title: '栞を残す',
    description: '読んだページや感想を記録できる投稿画面を、これから作ります。',
  },
  library: {
    title: '自分の本棚',
    description: '登録した本や読書の進み具合を、ここで確認できるようにします。',
  },
  me: {
    title: 'マイページ',
    description: 'プロフィールと、これまでに残した栞を表示する予定です。',
  },
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home')

  return (
    <div className="app">
      <header className="site-header">
        <span className="brand-mark" aria-hidden="true">▮</span>
        <span className="brand-name">Book Bear</span>
        <span className="header-note">読書の足あと</span>
      </header>

      <main className="content" id="main-content">
        {activeTab === 'home' ? (
          <>
            <section className="welcome">
              <p className="eyebrow">YOUR READING JOURNEY</p>
              <h1>本の中に、<br />あなたの栞を。</h1>
              <p className="intro">
                心に残ったページと、そのときの気持ちを記録する。
                小さな栞から、読書の思い出をつなげよう。
              </p>
              <button className="primary-button" onClick={() => setActiveTab('search')}>
                本を探してみる <span aria-hidden="true">→</span>
              </button>
            </section>

            <section className="section">
              <div className="section-heading">
                <h2>みんなの栞</h2>
                <span className="soft-label">これから表示されます</span>
              </div>
              <div className="empty-state">
                <div className="empty-icon" aria-hidden="true">▤</div>
                <p className="empty-title">栞はまだありません</p>
                <p className="empty-description">
                  投稿が集まると、ここに新しい栞が表示されます。
                </p>
              </div>
            </section>
          </>
        ) : (
          <section className="section placeholder-page">
            <p className="eyebrow">COMING SOON</p>
            <h1>{pageDetails[activeTab].title}</h1>
            <p className="placeholder-description">{pageDetails[activeTab].description}</p>
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">✦</div>
              <p className="empty-title">画面を準備中です</p>
              <p className="empty-description">まずは画面遷移の土台ができました。</p>
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="メインメニュー">
        <div className="bottom-nav-inner">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'nav-item nav-item-active' : 'nav-item'}
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              <span className="nav-symbol" aria-hidden="true">{tab.symbol}</span>
              <span className="nav-label">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
