import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type AnyRecord = Record<string, any>
type Profile = { id: string; name: string; roleDescription: string; instructions: string; skillIds: string[]; pluginIds: string[]; enabled: boolean; revision: number }
type KnowledgeBase = { id: string; name: string; description?: string }
type Task = { reviewOnly?: boolean; id: string; state: string; prompt?: string; promptPreview?: string; result?: string | null; waitingQuestion?: string | null; approvalId?: string | null; createdAt?: string }
type Event = { id: number; type: string; message: string; occurredAt: string }
type Capability = { id: string; name: string; state?: string; version?: string; description?: string }

const api = window.hyperweave
const MAX_LOCAL_FILE_BYTES = 100 * 1024 * 1024
const value = (o: AnyRecord | null | undefined, camel: string, snake = camel.replace(/[A-Z]/gu, m => `_${m.toLowerCase()}`)) => o?.[camel] ?? o?.[snake]
const toArray = <T,>(x: unknown): T[] => Array.isArray(x) ? x : Array.isArray((x as AnyRecord)?.items) ? (x as AnyRecord).items : []
const initials = (name = 'H') => name.trim().split(/\s+/u).slice(0, 2).map(x => x[0]).join('').toUpperCase()
const taskState = (state = '') => ({ QUEUED: '排队中', RUNNING: '执行中', WAITING_APPROVAL: '等待审批', WAITING_INPUT: '等待补充', SUCCEEDED: '已完成', FAILED: '失败', CANCELLED: '已取消', OUTCOME_UNKNOWN: '待核对' }[state] ?? state)

function App() {
  const [user, setUser] = useState<AnyRecord | null>(null)
  const [booting, setBooting] = useState(true)
  const [page, setPage] = useState<'home' | 'tasks' | 'agents' | 'library'>('home')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [skills, setSkills] = useState<Capability[]>([])
  const [plugins, setPlugins] = useState<Capability[]>([])
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<Task[]>([])
  const reviewingTask = useRef<string | null>(null)
  const approvalCache = useRef<{ id: string; detail: AnyRecord } | null>(null)
  const [approvalDetail, setApprovalDetail] = useState<AnyRecord | null>(null)
  const [approvalError, setApprovalError] = useState('')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskSyncError, setTaskSyncError] = useState('')
  const [events, setEvents] = useState<Event[]>([])
  const [artifacts, setArtifacts] = useState<AnyRecord[]>([])
  const [prompt, setPrompt] = useState('')
  const [profileId, setProfileId] = useState('')
  const [scope, setScope] = useState<string[]>([])
  const [uploadBaseId, setUploadBaseId] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [answer, setAnswer] = useState('')
  const [followup, setFollowup] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState<AnyRecord | null>(null)
  const [editing, setEditing] = useState<Profile | null>(null)

  const request = useCallback(<T,>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>) =>
    api.request<T>({ path, method, body, headers }), [])
  const loadPluginCatalog = useCallback(async () => {
    const plugins: AnyRecord[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ limit: '20' })
      if (cursor) query.set('afterPluginKey', cursor)
      const result = await request<AnyRecord>(`/api/agent/plugins/catalog?${query.toString()}`)
      plugins.push(...toArray<AnyRecord>(result.plugins))
      const next = value(result, 'nextPluginKey')
      if (typeof next !== 'string' || !next || seenCursors.has(next)) break
      seenCursors.add(next)
      cursor = next
    }
    return plugins
  }, [request])

  const loadWorkspace = useCallback(async () => {
    const session = await api.session()
    const results = await Promise.allSettled([
      request<AnyRecord[]>('/api/agent/profiles'), request<AnyRecord[]>('/api/skills/catalog'),
      loadPluginCatalog(), request<KnowledgeBase[]>('/api/rag/knowledge-bases'),
      request<AnyRecord>('/api/agent/tasks'),
      value(session, 'role') === 'TENANT_ADMIN' ? request<AnyRecord[]>('/api/agent/tasks/pending-approvals') : Promise.resolve([]),
    ])
    if (results[0].status === 'fulfilled') setProfiles(toArray<AnyRecord>(results[0].value).map(p => ({
      id: p.id, name: p.name, roleDescription: value(p, 'roleDescription') ?? '', instructions: p.instructions,
      skillIds: value(p, 'skillIds') ?? [], pluginIds: value(p, 'pluginIds') ?? [], enabled: p.enabled, revision: p.revision,
    })))
    if (results[1].status === 'fulfilled') setSkills(toArray<AnyRecord>(results[1].value).filter(s => s.enabled && value(s, 'activeVersion') != null)
      .map(s => ({ id: s.id, name: s.name, description: s.description, state: 'PUBLISHED', version: String(value(s, 'activeVersion')) })))
    if (results[2].status === 'fulfilled') setPlugins(toArray<AnyRecord>(results[2].value)
      .map(p => ({ id: value(p, 'pluginId'), name: value(p, 'pluginKey'), version: p.version, state: p.state })))
    if (results[3].status === 'fulfilled') setBases(toArray<KnowledgeBase>(results[3].value))
    if (results[4].status === 'fulfilled') setTasks(toArray<AnyRecord>(results[4].value).map(t => ({
      id: t.id, state: t.state, promptPreview: value(t, 'promptPreview') ?? value(t, 'prompt') ?? '', createdAt: value(t, 'createdAt'),
    })))
    if (results[5].status === 'fulfilled') setPendingApprovals(toArray<AnyRecord>(results[5].value).map(t => ({
      id: t.id, state: t.state, promptPreview: value(t, 'promptPreview') ?? '',
    })))
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') setNotice(`部分工作区信息暂时无法加载：${failed.reason instanceof Error ? failed.reason.message : '网络错误'}`)
  }, [loadPluginCatalog, request])

  useEffect(() => {
    let active = true
    api.session().then(async session => {
      if (!active) return
      setUser(session)
      if (session) await loadWorkspace()
    }).catch(error => setNotice(error instanceof Error ? error.message : '连接平台失败'))
      .finally(() => { if (active) setBooting(false) })
    return () => { active = false }
  }, [loadWorkspace])

  const refreshTask = useCallback(async (id: string) => {
    const [task, eventList, artifactList] = await Promise.all([
      request<AnyRecord>(`/api/agent/tasks/${encodeURIComponent(id)}`),
      request<AnyRecord[]>(`/api/agent/tasks/${encodeURIComponent(id)}/events?afterId=0`),
      request<AnyRecord[]>(`/api/agent/tasks/${encodeURIComponent(id)}/artifacts`),
    ])
    const approvalId = value(task, 'approvalId')
    setApprovalError('')
    if (task.state === 'WAITING_APPROVAL' && approvalId && value(await api.session(), 'role') === 'TENANT_ADMIN') {
      try {
        const cached = approvalCache.current
        const detail = cached && cached.id === approvalId ? cached.detail
          : await request<AnyRecord>(`/api/agent/tools/approvals/${encodeURIComponent(approvalId)}`)
        approvalCache.current = { id: approvalId, detail }
        setApprovalDetail(detail)
      } catch {
        setApprovalDetail(null)
        setApprovalError('暂时无法读取审批内容，请刷新后再批准。')
      }
    } else setApprovalDetail(null)
    setSelectedTask({
      reviewOnly: reviewingTask.current === id, id: task.id, state: task.state, prompt: value(task, 'prompt'), result: task.result,
      waitingQuestion: value(task, 'waitingQuestion'), approvalId: value(task, 'approvalId'),
      createdAt: value(task, 'createdAt'),
    })
    setEvents(toArray<AnyRecord>(eventList).map(e => ({ id: e.id, type: e.type, message: e.message, occurredAt: value(e, 'occurredAt') })))
    setArtifacts(toArray<AnyRecord>(artifactList))
    setTaskSyncError('')
    if (reviewingTask.current !== id) setTasks(previous => [{ id: task.id, state: task.state, promptPreview: value(task, 'promptPreview') ?? value(task, 'prompt') ?? '' }, ...previous.filter(t => t.id !== task.id)])
  }, [request])

  useEffect(() => {
    if (!selectedTask?.id || !['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_INPUT'].includes(selectedTask.state)) return
    const id = selectedTask.id
    const timer = window.setInterval(() => { void refreshTask(id).catch(() =>
      setTaskSyncError('暂时无法同步任务，当前显示上次读取的状态。连接恢复后会自动更新。')) }, 2500)
    return () => window.clearInterval(timer)
  }, [selectedTask?.id, selectedTask?.state, refreshTask])

  const enabledProfiles = useMemo(() => profiles.filter(p => p.enabled), [profiles])
  const canApproveTasks = value(user, 'role') === 'TENANT_ADMIN'

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setNotice('')
    try { setUser(await api.login({ email: email.trim(), password })); setPassword(''); await loadWorkspace() }
    catch (error) { setNotice(error instanceof Error ? error.message : '登录失败') }
    finally { setBusy(false) }
  }

  async function signOut() {
    await api.logout()
    setUser(null); setPage('home'); setProfiles([]); setTasks([]); setPendingApprovals([]); setSelectedTask(null)
    setTaskSyncError('')
    setSkills([]); setPlugins([]); setBases([]); setScope([]); setFiles([]); setUploadBaseId(''); setProfileId('')
    setEvents([]); setArtifacts([]); setAnswer(''); setFollowup(''); setPrompt(''); setDraft(null); setEditing(null); setNotice('')
    reviewingTask.current = null; approvalCache.current = null; setApprovalDetail(null); setApprovalError('')
  }

  async function submitTask(event: React.FormEvent) {
    event.preventDefault(); if (!prompt.trim()) return
    setBusy(true); setNotice('')
    try {
      const task = await api.submitTask<AnyRecord>({
        sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(), prompt: prompt.trim(),
        agentProfileId: profileId || undefined, knowledgeBaseIds: scope,
      })
      reviewingTask.current = null
      setPrompt(''); setPage('tasks'); await refreshTask(task.id)
    } catch (error) { setNotice(error instanceof Error ? error.message : '提交任务失败') }
    finally { setBusy(false) }
  }

  async function uploadFiles() {
    if (!files.length) return
    if (files.some(file => !/\.(pdf|docx|pptx|xlsx|png|jpe?g)$/iu.test(file.name))) {
      setNotice('平台支持 PDF、DOCX、PPTX、XLSX、PNG 和 JPG 文件，请移除其他格式后重试。')
      return
    }
    if (files.some(file => file.size > MAX_LOCAL_FILE_BYTES)) {
      setNotice('单个资料文件不能超过 100 MB，请移除超限文件后重试。')
      return
    }
    setBusy(true); setNotice('')
    try {
      let target = uploadBaseId || bases.find(b => scope.includes(b.id))?.id
      if (!target) {
        const created = await request<KnowledgeBase>('/api/rag/knowledge-bases', 'POST', {
          name: '我的资料', description: '通过 HyperWeave Desktop 提交的本地资料',
        })
        target = created.id; setUploadBaseId(created.id); setBases(current => [created, ...current]); setScope(current => [...current, created.id])
      }
      for (const file of files) {
        const document = await request<AnyRecord>(`/api/rag/knowledge-bases/${target}/documents`, 'POST', { source_name: file.name }, {
          'Idempotency-Key': crypto.randomUUID(),
        })
        const bytes = new Uint8Array(await file.arrayBuffer())
        await api.upload({ path: `/api/rag/knowledge-bases/${target}/documents/${document.id}/versions`,
          name: file.name, mediaType: file.type || 'application/octet-stream', bytes })
      }
      setFiles([]); setNotice(`已将 ${files.length} 个文件提交到平台知识库`); await loadWorkspace()
    } catch (error) { setNotice(error instanceof Error ? error.message : '上传资料失败') }
    finally { setBusy(false) }
  }

  async function downloadFile(path: string, fileName: string) {
    setNotice('')
    try { await api.download({ path, fileName }) }
    catch (error) { setNotice(error instanceof Error ? error.message : '下载失败，请重试。') }
  }

  async function openTask(id: string, reviewOnly = false) {
    reviewingTask.current = reviewOnly ? id : null
    setPage('tasks'); setNotice('')
    try { await refreshTask(id) } catch (error) { setNotice(error instanceof Error ? error.message : '读取任务失败') }
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); if (!draft) return
    setBusy(true); setNotice('')
    const body = { name: draft.name, role_description: draft.roleDescription, instructions: draft.instructions,
      skill_ids: draft.skillIds, plugin_ids: draft.pluginIds }
    try {
      if (editing) await request(`/api/agent/profiles/${editing.id}`, 'PUT', { ...body, enabled: editing.enabled, revision: editing.revision })
      else await request('/api/agent/profiles', 'POST', body)
      setDraft(null); setEditing(null); await loadWorkspace(); setNotice('角色 Agent 已保存')
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存角色失败') }
    finally { setBusy(false) }
  }

  async function deleteProfile(profile: Profile) {
    if (!window.confirm(`删除角色“${profile.name}”？`)) return
    try { await request(`/api/agent/profiles/${profile.id}`, 'DELETE'); await loadWorkspace() }
    catch (error) { setNotice(error instanceof Error ? error.message : '删除角色失败') }
  }

  async function setProfileEnabled(profile: Profile, enabled: boolean) {
    try {
      await request(`/api/agent/profiles/${profile.id}`, 'PUT', {
        name: profile.name, role_description: profile.roleDescription, instructions: profile.instructions,
        enabled, revision: profile.revision, skill_ids: profile.skillIds, plugin_ids: profile.pluginIds,
      })
      await loadWorkspace()
    } catch (error) { setNotice(error instanceof Error ? error.message : '修改角色状态失败') }
  }

  async function mutateTask(path: string, body: unknown) {
    if (!selectedTask) return
    setBusy(true)
    try {
      const result = await request<AnyRecord>(`/api/agent/tasks/${selectedTask.id}/${path}`, 'POST', body)
      setAnswer(''); setFollowup('')
      if (path === 'approval') approvalCache.current = null
      if (path === 'followups' && result?.id && result.id !== selectedTask.id) { setPage('tasks'); await refreshTask(result.id) }
      else await refreshTask(selectedTask.id)
      if (path === 'approval') await loadWorkspace()
    }
    catch (error) { setNotice(error instanceof Error ? error.message : '任务操作失败') }
    finally { setBusy(false) }
  }

  if (booting) return <div className="boot"><div className="brand-mark">H</div><span>正在连接 HyperWeave…</span></div>
  if (!user) return <main className="login-shell"><section className="login-art"><div className="brand"><span className="brand-mark">H</span><span>HYPERWEAVE</span></div><div className="login-copy"><div className="eyebrow">YOUR WORKSPACE, EXTENDED</div><h1>把复杂工作<br /><em>交给对的 Agent。</em></h1><p>角色、资料和工具都由你的组织管理。每项任务由 HyperWeave 平台在隔离沙箱中执行。</p><div className="login-orbit"><span>资料</span><span>Agent</span><span>平台沙箱</span></div></div><small>SECURE · PRIVATE · BUILT FOR YOUR TEAM</small></section><form className="login-form" onSubmit={signIn}><div className="eyebrow">WORKSPACE SIGN IN</div><h2>欢迎回来</h2><p>使用 HyperWeave 平台账号登录。</p><label>邮箱<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" /></label><label>密码<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="输入密码" /></label>{notice && <div className="notice error">{notice}</div>}<button className="button primary wide" disabled={busy}>{busy ? '正在登录…' : '登录 HyperWeave'}<span>↗</span></button><div className="privacy-note"><span>◈</span> 账号验证和会话续期由 HyperWeave 平台处理</div></form></main>

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">H</span><span>HYPERWEAVE</span></div><div className="workspace-switch"><span className="workspace-avatar">{initials(String(value(user, 'tenantName') ?? 'HW'))}</span><span><b>{value(user, 'tenantName') ?? '工作空间'}</b><small>{value(user, 'displayName') ?? value(user, 'username') ?? '已登录'}</small></span><span className="chevron">⌄</span></div><div className="nav-label">工作台</div><nav>{([
      ['home', '✳', '开始工作'], ['tasks', '◷', '任务记录'], ['agents', '◉', '我的 Agent'], ['library', '◇', 'Skills 与插件'],
    ] as const).map(([key, icon, label]) => <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} onClick={() => setPage(key)}><span className="nav-icon">{icon}</span>{label}{key === 'tasks' && tasks.length > 0 && <i>{tasks.length}</i>}</button>)}</nav><div className="sidebar-bottom"><div className="sandbox-chip"><span className="pulse"/><span><b>平台沙箱</b><small>任务隔离执行</small></span><span className="shield">◈</span></div><button className="nav-item" onClick={signOut}><span className="nav-icon">⇥</span>退出登录</button><div className="version">HyperWeave Desktop <span>0.1.0</span></div></div></aside>
    <main className="main-panel"><header className="topbar"><div className="breadcrumbs">工作台 <span>/</span> {page === 'home' ? '开始工作' : page === 'tasks' ? '任务记录' : page === 'agents' ? '我的 Agent' : 'Skills 与插件'}</div><div className="top-actions"><span className="connection">HyperWeave 平台</span><button className="avatar" title={String(value(user, 'displayName') ?? value(user, 'username') ?? '')}>{initials(String(value(user, 'displayName') ?? value(user, 'username') ?? 'HW'))}</button></div></header>
      <section className="page-content">
        {notice && <div className="notice"><span>ⓘ</span>{notice}<button onClick={() => setNotice('')}>×</button></div>}
        {page === 'home' && <>
          <div className="welcome-row"><div><div className="eyebrow">HYPERWEAVE WORKSPACE</div><h1>今天想完成什么？</h1><p>选择角色 Agent 和资料范围，把工作目标交给平台执行。</p></div><div className="welcome-date">{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date())}</div></div>
          <div className="home-grid"><form className="panel task-composer" onSubmit={submitTask}><div className="panel-heading"><span className="heading-icon lilac">✳</span><div><h2>开始一项工作</h2><p>说清楚结果，Agent 会在隔离沙箱中处理</p></div></div><textarea className="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="例如：阅读选定资料，整理本季度合同续约的关键风险和待确认事项…"/><div className="composer-controls"><label className="field-label">使用角色<select value={profileId} onChange={e => setProfileId(e.target.value)}><option value="">默认 Agent</option>{enabledProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="button primary" disabled={busy || !prompt.trim()}>{busy ? '正在提交…' : '提交任务'}<span>↗</span></button></div><div className="scope-block"><div className="scope-title"><span>▤</span><div><b>资料范围</b><small>Agent 只能读取你选中的知识库</small></div></div><div className="scope-list">{bases.length ? bases.map(base => <label className="scope-option" key={base.id}><input type="checkbox" checked={scope.includes(base.id)} onChange={e => setScope(v => e.target.checked ? [...v, base.id] : v.filter(id => id !== base.id))}/><span className="folder-icon">▱</span><span>{base.name}</span></label>) : <span className="muted">还没有资料空间，请先添加本地资料。</span>}</div></div></form>
          <section className="panel upload-panel"><div className="panel-heading"><span className="heading-icon mint">↑</span><div><h2>添加本地资料</h2><p>上传后在平台解析和索引，不在本机执行</p></div></div><label className="field-label upload-destination">保存到<select value={uploadBaseId} onChange={e => setUploadBaseId(e.target.value)}><option value="">沿用所选资料范围或新建空间</option>{bases.map(base => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label><label className="dropzone"><input type="file" accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg" multiple onChange={e => setFiles(Array.from(e.target.files ?? []))}/><span className="upload-icon">↑</span><b>选择文件或拖到这里</b><small>PDF、DOCX、PPTX、XLSX、PNG、JPG · 单个文件不超过 100 MB</small></label>{files.length > 0 && <div className="file-list">{files.map((file, index) => <div key={`${file.name}-${index}`}><span>▤</span><span>{file.name}<small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button onClick={() => setFiles(v => v.filter((_, i) => i !== index))}>×</button></div>)}</div>}<button className="button secondary wide" onClick={() => void uploadFiles()} disabled={busy || files.length === 0}>{busy ? '正在上传…' : `安全上传 ${files.length || ''} 个文件`}<span>↑</span></button><div className="upload-footnote">上传的资料归属于当前账号权限，并可按任务限制读取范围。</div></section></div>
          <div className="section-row"><div><div className="eyebrow">YOUR AGENTS</div><h2>角色 Agent</h2></div><button className="text-button" onClick={() => setPage('agents')}>管理角色 <span>→</span></button></div><div className="agent-cards">{enabledProfiles.slice(0, 3).map((profile, index) => <button key={profile.id} className="agent-card" onClick={() => { setProfileId(profile.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><span className={`agent-avatar color-${index % 3}`}>{initials(profile.name)}</span><span><b>{profile.name}</b><small>{profile.roleDescription || '自定义工作角色'}</small></span><span className="card-arrow">↗</span></button>)}<button className="agent-card add-card" onClick={() => { setEditing(null); setDraft({ name: '', roleDescription: '', instructions: '', skillIds: [], pluginIds: [] }); setPage('agents') }}><span className="add-circle">＋</span><span><b>创建新角色</b><small>定义 Agent 的工作方式</small></span></button></div>
          <div className="recent-row"><div className="section-row"><div><div className="eyebrow">RECENT ACTIVITY</div><h2>最近任务</h2></div><button className="text-button" onClick={() => setPage('tasks')}>查看全部 <span>→</span></button></div>{tasks.slice(0, 3).length ? <div className="recent-list">{tasks.slice(0, 3).map(task => <button key={task.id} onClick={() => void openTask(task.id)}><span className="task-state-dot" data-state={task.state}/><span>{task.promptPreview || 'Agent 任务'}</span><i className={`status-pill s-${task.state.toLowerCase()}`}>{taskState(task.state)}</i><span className="card-arrow">→</span></button>)}</div> : <div className="empty-inline">尚无任务记录。提交一项工作后，结果会显示在这里。</div>}</div>
        </>}

        {page === 'agents' && <><div className="welcome-row"><div><div className="eyebrow">PERSONAL AGENTS</div><h1>我的 Agent</h1><p>为不同工作定义角色指令，并绑定平台审核通过的 Skills 和插件。</p></div><button className="button primary" onClick={() => { setEditing(null); setDraft({ name: '', roleDescription: '', instructions: '', skillIds: [], pluginIds: [] }) }}>＋ 新建角色</button></div><div className="agent-list">{profiles.map(profile => <article className="panel profile-card" key={profile.id}><div className="profile-head"><span className="agent-avatar color-0">{initials(profile.name)}</span><div><h2>{profile.name}</h2><p>{profile.roleDescription || '自定义工作角色'}</p></div><span className={`status-pill ${profile.enabled ? 's-succeeded' : ''}`}>{profile.enabled ? '已启用' : '已停用'}</span></div><p className="instructions-preview">{profile.instructions}</p><div className="capability-tags">{profile.skillIds.map(id => <span key={id}>✳ {skills.find(s => s.id === id)?.name ?? '不可用 Skill'}</span>)}{profile.pluginIds.map(id => <span key={id}>◇ {plugins.find(p => p.id === id)?.name ?? '不可用插件'}</span>)}{profile.skillIds.length + profile.pluginIds.length === 0 && <span className="muted">尚未绑定能力</span>}</div><div className="profile-actions"><button className="text-button" onClick={() => void setProfileEnabled(profile, !profile.enabled)}>{profile.enabled ? '停用' : '启用'}</button><button className="text-button" onClick={() => { setEditing(profile); setDraft({ ...profile }) }}>编辑</button><button className="text-button danger" onClick={() => void deleteProfile(profile)}>删除</button></div></article>)}{profiles.length === 0 && <div className="panel empty-state"><span>◉</span><h2>从一个角色开始</h2><p>给 Agent 设定明确的工作方式，再绑定你有权限使用的 Skills 和插件。</p><button className="button primary" onClick={() => { setEditing(null); setDraft({ name: '', roleDescription: '', instructions: '', skillIds: [], pluginIds: [] }) }}>创建第一个角色</button></div>}</div>{draft && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { setDraft(null); setEditing(null) } }}><form className="modal-card" onSubmit={e => void saveProfile(e)}><div className="modal-title"><div><div className="eyebrow">AGENT PROFILE</div><h2>{editing ? '编辑角色' : '创建角色'}</h2></div><button type="button" onClick={() => { setDraft(null); setEditing(null) }}>×</button></div><label>角色名称<input required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="例如：研究助理" /></label><label>角色简介<input maxLength={1000} value={draft.roleDescription} onChange={e => setDraft({ ...draft, roleDescription: e.target.value })} placeholder="擅长的工作类型" /></label><label>工作方式与指令<textarea required maxLength={32768} rows={6} value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} placeholder="描述目标、步骤、语气和需要遵循的约束" /></label><div className="binding-group"><b>可使用 Skills</b><small>只展示当前账号有权使用的已发布 Skill</small>{skills.map(skill => <label key={skill.id}><input type="checkbox" checked={(draft.skillIds ?? []).includes(skill.id)} onChange={e => setDraft({ ...draft, skillIds: e.target.checked ? [...draft.skillIds, skill.id] : draft.skillIds.filter((id: string) => id !== skill.id) })}/><span>{skill.name}</span><i>v{skill.version}</i></label>)}{draft.skillIds.filter((id: string) => !skills.some(skill => skill.id === id)).map((id: string) => <label key={id}><input type="checkbox" checked onChange={() => setDraft({ ...draft, skillIds: draft.skillIds.filter((value: string) => value !== id) })}/><span>不可用 Skill · {id}<small>已停用或权限已变更，取消勾选可移除</small></span></label>)}</div><div className="binding-group"><b>可使用插件</b><small>只展示当前租户已发布的业务插件</small>{plugins.map(plugin => <label key={plugin.id}><input type="checkbox" checked={(draft.pluginIds ?? []).includes(plugin.id)} onChange={e => setDraft({ ...draft, pluginIds: e.target.checked ? [...draft.pluginIds, plugin.id] : draft.pluginIds.filter((id: string) => id !== plugin.id) })}/><span>{plugin.name}</span><i>v{plugin.version}</i></label>)}{draft.pluginIds.filter((id: string) => !plugins.some(plugin => plugin.id === id)).map((id: string) => <label key={id}><input type="checkbox" checked onChange={() => setDraft({ ...draft, pluginIds: draft.pluginIds.filter((value: string) => value !== id) })}/><span>不可用插件 · {id}<small>已撤销或权限已变更，取消勾选可移除</small></span></label>)}</div><div className="modal-actions"><button type="button" className="button ghost" onClick={() => { setDraft(null); setEditing(null) }}>取消</button><button className="button primary" disabled={busy}>{busy ? '保存中…' : '保存角色'}</button></div></form></div>}</>}

        {page === 'library' && <><div className="welcome-row"><div><div className="eyebrow">CONTROLLED CATALOG</div><h1>Skills 与插件</h1><p>仅显示 HyperWeave 租户目录中审核发布且当前账号可用的能力。</p></div><span className="connection"><i/> 受控目录</span></div><div className="catalog-grid"><section className="panel"><div className="panel-heading"><span className="heading-icon lilac">✳</span><div><h2>Skills</h2><p>可绑定到你的角色 Agent</p></div></div>{skills.length ? skills.map(skill => <div className="catalog-item" key={skill.id}><span className="catalog-symbol">✳</span><span><b>{skill.name}</b><small>{skill.description || '平台审核通过的 Skill'}</small></span><span className="catalog-version">v{skill.version}</span></div>) : <div className="empty-inline">当前账号没有可安装的已发布 Skill。</div>}</section><section className="panel"><div className="panel-heading"><span className="heading-icon mint">◇</span><div><h2>业务插件</h2><p>在平台隔离工作负载中运行</p></div></div>{plugins.length ? plugins.map(plugin => <div className="catalog-item" key={plugin.id}><span className="catalog-symbol">◇</span><span><b>{plugin.name}</b><small>HyperWeave 受控业务插件</small></span><span className="catalog-version">v{plugin.version}</span></div>) : <div className="empty-inline">当前账号没有可安装的已发布插件。</div>}</section></div><div className="catalog-hint">将能力绑定到 Agent 角色即可使用。授权与撤权由 HyperWeave 平台实时执行。</div></>}

        {page === 'tasks' && <><div className="welcome-row"><div><div className="eyebrow">TASK HISTORY</div><h1>任务记录</h1><p>查看平台沙箱中的执行进度、审批、补充输入和结果。</p></div><button className="button primary" onClick={() => setPage('home')}>＋ 新任务</button></div>{canApproveTasks && <section className="panel approval-queue"><div className="section-row"><h2>待我审批</h2><button className="text-button" onClick={() => void loadWorkspace().catch(error => setNotice(error instanceof Error ? error.message : '刷新失败'))}>刷新待审批任务</button></div>{pendingApprovals.length ? pendingApprovals.map(task => <button className="task-list-item" key={task.id} onClick={() => void openTask(task.id, true)}><span className="task-state-dot" data-state="WAITING_APPROVAL"/><span><b>{task.promptPreview || 'Agent 任务'}</b><small>{task.id}</small></span><i className="status-pill">查看审批</i></button>) : <p className="empty-inline">暂无待审批任务</p>}</section>}<div className="tasks-layout"><div className="panel task-list-panel"><div className="list-title">所有任务 <span>{tasks.length}</span></div>{tasks.length ? tasks.map(task => <button key={task.id} className={`task-list-item ${selectedTask?.id === task.id ? 'selected' : ''}`} onClick={() => void openTask(task.id)}><span className="task-state-dot" data-state={task.state}/><span><b>{task.promptPreview || task.prompt || 'Agent 任务'}</b><small>{task.createdAt ? new Date(task.createdAt).toLocaleString('zh-CN') : '最近提交'}</small></span><i className={`status-pill s-${task.state.toLowerCase()}`}>{taskState(task.state)}</i></button>) : <div className="empty-inline">暂无任务</div>}</div><div className="panel task-detail">{selectedTask ? <><div className="task-detail-head"><div><div className="eyebrow">PLATFORM TASK · {selectedTask.id.slice(0, 8)}</div><h2>{selectedTask.prompt || 'Agent 任务'}</h2></div><div className="task-actions"><span className={`status-pill s-${selectedTask.state.toLowerCase()}`}>{taskState(selectedTask.state)}</span>{!selectedTask.reviewOnly && ['QUEUED', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL'].includes(selectedTask.state) && <button className="text-button danger" disabled={busy} onClick={() => void mutateTask('cancel', {})}>停止任务</button>}{!selectedTask.reviewOnly && selectedTask.state === 'OUTCOME_UNKNOWN' && <button className="button secondary" disabled={busy} onClick={() => void mutateTask('recover', {})}>{busy ? '正在恢复…' : '恢复任务状态'}</button>}</div></div>{taskSyncError && <p className="notice" role="status">{taskSyncError}</p>}{selectedTask.state === 'WAITING_APPROVAL' && <div className="action-card"><b>Agent 正在等待你的审批</b><p>{canApproveTasks ? '平台需要你确认后才会继续执行。' : '这项任务需要租户管理员审批，审批完成后会自动继续。'}</p>{canApproveTasks && <>{approvalError && <p role="alert">{approvalError}</p>}{approvalDetail && value(approvalDetail.approval, 'id') === selectedTask.approvalId && <div className="approval-detail"><p><b>Skill：</b>{skills.find(skill => skill.id === value(approvalDetail.approval, 'skillId'))?.name ?? value(approvalDetail.approval, 'skillId')} · v{approvalDetail.approval.version}</p><p><b>执行能力：</b>{approvalDetail.approval.capability}</p><p><b>风险：</b>{({ HIGH: '高风险', CRITICAL: '关键风险' } as AnyRecord)[value(approvalDetail.approval, 'riskLevel')] ?? value(approvalDetail.approval, 'riskLevel')} · 需要 {value(approvalDetail.approval, 'requiredApprovals')} 位管理员批准</p><b>本次操作参数</b><pre>{JSON.stringify(approvalDetail.input, null, 2)}</pre>{value(approvalDetail, 'requesterUserId') === user?.id && <p>请由其他管理员审批你提交的操作。</p>}</div>}<div><button className="button ghost" disabled={busy} onClick={() => void mutateTask('approval', { approve: false })}>拒绝</button><button className="button primary" disabled={busy || !approvalDetail || value(approvalDetail.approval, 'id') !== selectedTask.approvalId || value(approvalDetail, 'requesterUserId') === user?.id} onClick={() => void mutateTask('approval', { approve: true })}>批准继续</button></div></>}</div>}{!selectedTask.reviewOnly && selectedTask.state === 'WAITING_INPUT' && <div className="action-card"><b>Agent 需要补充信息</b><p>{selectedTask.waitingQuestion || '请补充完成任务所需的信息。'}</p><textarea value={answer} onChange={e => setAnswer(e.target.value)} placeholder="输入补充信息"/><button className="button primary" disabled={busy || !answer.trim()} onClick={() => void mutateTask('input', { responseId: crypto.randomUUID(), response: answer.trim() })}>提交补充信息</button></div>}<div className="timeline"><h3>执行阶段</h3>{events.length ? events.map(event => <div className="timeline-item" key={event.id}><span className="timeline-dot"/><div><b>{event.message}</b><small>{new Date(event.occurredAt).toLocaleString('zh-CN')}</small></div></div>) : <div className="empty-inline">任务事件会在平台执行过程中显示。</div>}</div>{selectedTask.result && <div className="result-block"><h3>任务结果</h3><pre>{selectedTask.result}</pre><button className="text-button" onClick={() => void downloadFile(`/api/agent/tasks/${selectedTask.id}/result`, `hyperweave-task-${selectedTask.id}.txt`)}>保存结果 ↓</button></div>}{artifacts.length > 0 && <div className="artifact-block"><h3>产物</h3>{artifacts.map(artifact => <div key={artifact.id}><span>▤</span><span>{value(artifact, 'fileName')}<small>{Math.ceil((value(artifact, 'size') ?? 0) / 1024)} KB</small></span><button className="text-button" onClick={() => void downloadFile(`/api/agent/tasks/${selectedTask.id}/artifacts/${artifact.id}/download`, value(artifact, 'fileName'))}>下载 ↓</button></div>)}</div>}{!selectedTask.reviewOnly && selectedTask.state === 'SUCCEEDED' && <div className="followup"><h3>继续这项工作</h3><textarea value={followup} onChange={e => setFollowup(e.target.value)} placeholder="补充问题，创建一项关联的后续任务"/><button className="button secondary" disabled={busy || !followup.trim()} onClick={() => void mutateTask('followups', { requestId: crypto.randomUUID(), prompt: followup.trim() })}>创建后续任务 ↗</button></div>}</> : <div className="empty-state"><span>◷</span><h2>选择一项任务</h2><p>从左侧列表查看执行进度和结果。</p></div>}</div></div></>}
      </section>
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
