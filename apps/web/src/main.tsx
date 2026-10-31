import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <h1>Book Bear</h1>
      <p>本の中に、あなたの栞を。</p>
    </main>
  </StrictMode>,
)
