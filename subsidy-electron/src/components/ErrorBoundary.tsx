/**
 * React Error Boundary — 捕获渲染崩溃，显示恢复界面而非白屏
 */
import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: string
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] 渲染错误:', error.message, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: '' })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="text-center p-8 max-w-md">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-lg font-bold text-text-primary mb-2">页面渲染出错</h2>
            <p className="text-sm text-text-muted mb-4 break-all">
              {this.state.error || '未知错误'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 text-sm bg-primary-500 text-white rounded-btn hover:bg-primary-600"
              >
                重试
              </button>
              <button
                onClick={() => {
                  this.handleReset()
                  window.location.hash = '#/'
                  window.location.reload()
                }}
                className="px-4 py-2 text-sm border border-border rounded-btn hover:bg-warm/30"
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
