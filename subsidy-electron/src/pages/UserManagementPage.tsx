/**
 * 用户管理页
 */
import { useState, useEffect } from 'react'
import { getAuth } from './LoginPage'
import Modal from '../components/Modal'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'

interface UserInfo { id: number; username: string; display_name: string; role: string; is_active: boolean }

export default function UserManagementPage() {
  const { toast, show } = useToast()
  const auth = getAuth()
  const [users, setUsers] = useState<UserInfo[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'operator' })
  const [pwdForm, setPwdForm] = useState({ old_password: '', new_password: '' })

  const load = async () => {
    try { setUsers(await window.electronAPI.invoke('auth:listUsers')) } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

  const createUser = async () => {
    if (!form.username || !form.password) return show('用户名和密码不能为空', 'err')
    try {
      await window.electronAPI.invoke('auth:createUser', form)
      show('✓ 用户创建成功'); setAddOpen(false)
      setForm({ username: '', password: '', display_name: '', role: 'operator' })
      load()
    } catch (e) { show((e as Error).message, 'err') }
  }

  const toggleUser = async (u: UserInfo) => {
    try {
      await window.electronAPI.invoke('auth:updateUser', { id: u.id, is_active: !u.is_active })
      load()
    } catch (e) { show((e as Error).message, 'err') }
  }

  const changePwd = async () => {
    if (!pwdForm.old_password || !pwdForm.new_password) return show('请填写完整', 'err')
    try {
      await window.electronAPI.invoke('auth:changePassword', pwdForm)
      show('✓ 密码已修改'); setPwdOpen(false)
      setPwdForm({ old_password: '', new_password: '' })
    } catch (e) { show((e as Error).message, 'err') }
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-lg font-bold mb-4">👤 用户管理</h1>

      <div className="flex items-center gap-3 mb-4">
        {auth?.role === 'admin' && (
          <button onClick={() => setAddOpen(true)} className="px-3 py-2 text-sm bg-primary  rounded-btn hover:bg-primary/90">
            ＋ 新增用户
          </button>
        )}
        <button onClick={() => setPwdOpen(true)} className="px-3 py-2 text-sm border border-border rounded-btn hover:bg-warm/30">
          🔒 修改密码
        </button>
      </div>

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-warm/30 border-b border-border">
            {['用户名', '显示名', '角色', '状态', '操作'].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-xs text-text-muted font-semibold">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-border/30 hover:bg-warm/10">
                <td className="px-4 py-2.5 font-medium">{u.username}</td>
                <td className="px-4 py-2.5 text-text-muted">{u.display_name}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded ${u.role === 'admin' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                    {u.role === 'admin' ? '管理员' : '操作员'}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs ${u.is_active ? 'text-emerald-600' : 'text-text-muted/50'}`}>
                    {u.is_active ? '启用' : '禁用'}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {auth?.role === 'admin' && u.username !== 'admin' && (
                    <button onClick={() => toggleUser(u)}
                      className={`text-xs px-2 py-1 rounded-btn ${u.is_active ? 'text-red-500 hover:bg-red-50' : 'text-emerald-500 hover:bg-emerald-50'}`}>
                      {u.is_active ? '禁用' : '启用'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="text-center py-8 text-text-muted/50 text-sm">暂无用户</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 新增用户 */}
      <Modal open={addOpen} title="新增用户" onClose={() => setAddOpen(false)} onConfirm={createUser}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">用户名 *</label>
            <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">密码 *</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">显示名称</label>
            <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">角色</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm bg-white outline-none">
              <option value="operator">操作员</option>
              <option value="admin">管理员</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* 修改密码 */}
      <Modal open={pwdOpen} title="修改密码" onClose={() => setPwdOpen(false)} onConfirm={changePwd}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">原密码</label>
            <input type="password" value={pwdForm.old_password} onChange={e => setPwdForm(f => ({ ...f, old_password: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none" />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">新密码</label>
            <input type="password" value={pwdForm.new_password} onChange={e => setPwdForm(f => ({ ...f, new_password: e.target.value }))}
              className="w-full border border-border rounded-btn px-3 py-2 text-sm outline-none" />
          </div>
        </div>
      </Modal>

      <Toast {...toast} />
    </div>
  )
}
