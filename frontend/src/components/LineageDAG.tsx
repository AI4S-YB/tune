import { useEffect, useState, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useLanguage } from '../i18n/LanguageContext'

interface LineageNode {
  id: string
  type: 'sample' | 'experiment' | 'file' | 'job' | 'step' | 'result'
  label: string
  attrs: Record<string, unknown>
}

interface LineageEdge {
  source: string
  target: string
}

interface LineageData {
  nodes: LineageNode[]
  edges: LineageEdge[]
}

interface Props {
  projectId: string
}

const NODE_COLOR: Record<string, string> = {
  sample:     '#22c55e',
  experiment: '#3b82f6',
  file:       '#9ca3af',
  job:        '#f97316',
  step:       '#14b8a6',
  result:     '#a855f7',
}

const NODE_BG: Record<string, string> = {
  sample:     'rgba(34,197,94,0.10)',
  experiment: 'rgba(59,130,246,0.10)',
  file:       'rgba(156,163,175,0.10)',
  job:        'rgba(249,115,22,0.10)',
  step:       'rgba(20,184,166,0.10)',
  result:     'rgba(168,85,247,0.10)',
}

const TYPE_ORDER = ['sample', 'experiment', 'file', 'job', 'step', 'result'] as const

/** Kahn's topological sort — returns node ids in dependency order */
function topoSort(ids: string[], edges: LineageEdge[]): string[] {
  const inDegree = new Map<string, number>(ids.map(id => [id, 0]))
  const adj = new Map<string, string[]>(ids.map(id => [id, []]))
  for (const e of edges) {
    if (!adj.has(e.source) || !inDegree.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
  }
  const queue = ids.filter(id => (inDegree.get(id) ?? 0) === 0)
  const result: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(id)
    for (const nb of (adj.get(id) ?? [])) {
      const d = (inDegree.get(nb) ?? 1) - 1
      inDegree.set(nb, d)
      if (d === 0) queue.push(nb)
    }
  }
  // Append any remaining nodes (cycles / disconnected)
  for (const id of ids) if (!result.includes(id)) result.push(id)
  return result
}

function buildFlowData(lineageNodes: LineageNode[], lineageEdges: LineageEdge[]) {
  const nodeMap = new Map(lineageNodes.map(n => [n.id, n]))

  // Build parent map for y-centroid computation
  const parents = new Map<string, string[]>(lineageNodes.map(n => [n.id, []]))
  for (const e of lineageEdges) {
    parents.get(e.target)?.push(e.source)
  }

  // Column x positions — only columns that have nodes
  const COL_W = 240
  const ROW_H = 80
  const NODE_W = 180

  const typesPresent = TYPE_ORDER.filter(t => lineageNodes.some(n => n.type === t))
  const typeToColX = new Map(typesPresent.map((t, i) => [t, i * COL_W]))

  // Assign y positions via topological order + parent-centroid heuristic
  const order = topoSort(lineageNodes.map(n => n.id), lineageEdges)
  const yPos = new Map<string, number>()
  const colNextY = new Map<string, number>(TYPE_ORDER.map(t => [t, 0]))

  for (const id of order) {
    const n = nodeMap.get(id)
    if (!n) continue
    const parentYs = (parents.get(id) ?? [])
      .map(pid => yPos.get(pid))
      .filter((y): y is number => y != null)
    const naturalY = parentYs.length > 0
      ? parentYs.reduce((a, b) => a + b, 0) / parentYs.length
      : 0
    const minY = colNextY.get(n.type) ?? 0
    const y = Math.max(naturalY, minY)
    yPos.set(id, y)
    colNextY.set(n.type, y + ROW_H)
  }

  const nodes: Node[] = lineageNodes.map(n => ({
    id: n.id,
    position: { x: typeToColX.get(n.type) ?? 0, y: yPos.get(n.id) ?? 0 },
    data: { label: n.label, nodeType: n.type, attrs: n.attrs },
    style: {
      background: NODE_BG[n.type] ?? NODE_BG.file,
      border: `1px solid ${NODE_COLOR[n.type] ?? NODE_COLOR.file}`,
      borderRadius: 6,
      color: '#f3f4f6',
      fontSize: 11,
      padding: '6px 10px',
      width: NODE_W,
    },
  }))

  const edges: Edge[] = lineageEdges.map((e, i) => ({
    id: `e-${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    style: { stroke: '#4b5563', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#4b5563' },
  }))

  return { nodes, edges }
}

export default function LineageDAG({ projectId }: Props) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)
  const [selected, setSelected] = useState<LineageNode | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const nodeTypeLabels: Record<string, string> = {
    sample:     t('lineage_node_sample'),
    experiment: t('lineage_node_experiment'),
    file:       t('lineage_node_file'),
    job:        t('lineage_node_job'),
    step:       t('lineage_node_step'),
    result:     t('lineage_node_result'),
  }

  useEffect(() => {
    setLoading(true)
    setEmpty(false)
    setSelected(null)
    fetch(`/api/projects/${projectId}/lineage`)
      .then(r => r.json() as Promise<LineageData>)
      .then(data => {
        if (!data.nodes?.length) { setEmpty(true); return }
        const { nodes: n, edges: e } = buildFlowData(data.nodes, data.edges)
        setNodes(n)
        setEdges(e)
      })
      .catch(() => setEmpty(true))
      .finally(() => setLoading(false))
  }, [projectId])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelected({
      id: node.id,
      type: (node.data.nodeType as LineageNode['type']) ?? 'file',
      label: node.data.label as string,
      attrs: node.data.attrs as Record<string, unknown>,
    })
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
        {t('lineage_loading')}
      </div>
    )
  }

  if (empty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-8">
        <p className="text-sm text-text-muted">{t('lineage_empty')}</p>
        <p className="text-xs text-text-muted">{t('lineage_empty_hint')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1" style={{ minHeight: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          fitView
          colorMode="dark"
          attributionPosition="bottom-right"
        >
          <Background color="#374151" gap={20} />
          <Controls />
          <MiniMap
            nodeColor={(n: Node) => NODE_COLOR[(n.data?.nodeType as string) ?? 'file'] ?? '#9ca3af'}
            maskColor="rgba(17,24,39,0.7)"
          />
        </ReactFlow>
      </div>
      {selected && (
        <div className="w-52 shrink-0 border-l border-border-subtle flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
            <span
              className="text-xs font-semibold"
              style={{ color: NODE_COLOR[selected.type] ?? '#9ca3af' }}
            >
              {nodeTypeLabels[selected.type] ?? selected.type}
            </span>
            <button
              onClick={() => setSelected(null)}
              className="text-text-muted hover:text-text-primary text-xs"
            >✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1 text-xs">
            <p className="font-medium text-text-primary break-words mb-2">{selected.label}</p>
            {Object.entries(selected.attrs).map(([k, v]) =>
              v != null && v !== '' ? (
                <div key={k} className="flex gap-1 flex-wrap">
                  <span className="text-text-muted shrink-0">{k}:</span>
                  <span className="text-text-primary break-all">{String(v)}</span>
                </div>
              ) : null
            )}
          </div>
        </div>
      )}
    </div>
  )
}
