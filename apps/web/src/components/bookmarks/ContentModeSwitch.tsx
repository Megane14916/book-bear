import { useId } from 'react'
import type { FeedContentMode } from './BookmarkBody'

export function ContentModeSwitch({ value, onChange }: { value: FeedContentMode; onChange: (mode: FeedContentMode) => void }) {
  const name = useId()
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-bold">本文の表示方法</legend>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {(['all', 'tap'] as const).map((mode) => (
          <label key={mode} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name={name} value={mode} checked={value === mode} onChange={() => onChange(mode)}
              className="h-4 w-4 accent-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest" />
            {mode === 'all' ? 'すべて表示' : 'タップして表示'}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
