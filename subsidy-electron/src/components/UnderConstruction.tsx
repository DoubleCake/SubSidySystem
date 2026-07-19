import Icon from './Icon'

interface UnderConstructionProps {
  title?: string
  message?: string
}

export default function UnderConstruction({
  title = '该页面正在施工',
  message = '功能开发中，敬请期待…',
}: UnderConstructionProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Icon name="question" size={56} className="text-border mb-4" />
      <h2 className="text-h2 text-text-primary mb-2">{title}</h2>
      <p className="text-body text-text-muted">{message}</p>
      <div className="mt-6 flex items-center gap-2 text-meta text-text-muted/50">
        <span className="inline-block w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
        施工中
      </div>
    </div>
  )
}
