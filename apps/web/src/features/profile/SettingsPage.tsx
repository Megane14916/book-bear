import { Link } from 'react-router'
import { useContentPreference } from '../feed/useContentPreference'

export default function SettingsPage() {
  const { control } = useContentPreference()
  return <section className="space-y-5">
    <h1 className="text-3xl font-bold">設定</h1>
    {control}
    <Link to="/me" className="ui-action inline-flex text-forest underline">マイページへ戻る</Link>
  </section>
}
