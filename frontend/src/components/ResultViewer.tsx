import { useEffect, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import type { TranslationKey } from '../i18n/translations'

export interface ResultItem {
  kind: 'png' | 'csv' | 'html'
  path: string
  filename: string
  step: string
}

function resultKindLabel(kind: ResultItem['kind'], t: (key: TranslationKey) => string): string {
  if (kind === 'html') return t('result_kind_report')
  if (kind === 'csv') return t('result_kind_table')
  if (kind === 'png') return t('result_kind_plot')
  return t('result_kind_file')
}

function ResultHeader({ kind, filename, step }: { kind: ResultItem['kind']; filename: string; step: string }) {
  const { t } = useLanguage()
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
        {resultKindLabel(kind, t)}
      </span>
      <span className="text-gray-500">{step}</span>
      <span className="text-gray-600">→</span>
      <span className="text-gray-300">{filename}</span>
    </div>
  )
}

export default function ResultViewer({ kind, path, filename, step }: ResultItem) {
  const { t } = useLanguage()
  const src = `/api/jobs/result?path=${encodeURIComponent(path)}`

  if (kind === 'png') {
    return (
      <div className="my-3">
        <ResultHeader kind={kind} filename={filename} step={step} />
        <img
          src={src}
          alt={filename}
          className="max-w-full rounded border border-gray-700"
        />
      </div>
    )
  }

  if (kind === 'html') {
    return (
      <div className="my-3">
        <ResultHeader kind={kind} filename={filename} step={step} />
        <iframe
          src={src}
          title={filename}
          className="w-full h-72 rounded border border-gray-700 bg-white"
          sandbox="allow-scripts allow-same-origin"
        />
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-400 hover:underline mt-1 inline-block"
        >
          {t('result_open_report')}
        </a>
      </div>
    )
  }

  if (kind === 'csv') {
    return <CsvTable src={src} filename={filename} step={step} />
  }

  return null
}

const PAGE_SIZE = 20

function CsvTable({ src, filename, step }: { src: string; filename: string; step: string }) {
  const { t } = useLanguage()
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(src)
      .then((r) => r.text())
      .then((text) => {
        const lines = text.trim().split('\n').filter(Boolean)
        if (!lines.length) return
        const parse = (line: string) =>
          line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
        const [header, ...data] = lines
        setHeaders(parse(header))
        setRows(data.map(parse))
      })
      .catch(() => setError(t('result_csv_load_error')))
  }, [src])

  const sorted =
    sortCol !== null
      ? [...rows].sort((a, b) => {
          const av = a[sortCol] ?? ''
          const bv = b[sortCol] ?? ''
          const n = parseFloat(av) - parseFloat(bv)
          if (!isNaN(n)) return sortAsc ? n : -n
          return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
        })
      : rows

  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)

  return (
    <div className="my-3">
      <ResultHeader kind="csv" filename={filename} step={step} />
      {error ? (
        <p className="text-red-400 text-xs">{error}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-gray-700">
            <table className="text-xs text-gray-300 w-full">
              <thead className="bg-gray-800 sticky top-0">
                <tr>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      className="px-2 py-1.5 text-left cursor-pointer hover:text-white select-none whitespace-nowrap"
                      onClick={() => {
                        setSortAsc(sortCol === i ? !sortAsc : true)
                        setSortCol(i)
                        setPage(0)
                      }}
                    >
                      {h}
                      {sortCol === i ? (sortAsc ? ' ↑' : ' ↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((row, ri) => (
                  <tr
                    key={ri}
                    className={ri % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/50'}
                  >
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2 py-1 whitespace-nowrap">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
            <span>{t('result_rows').replace('{n}', String(sorted.length))}</span>
            {totalPages > 1 && (
              <>
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="hover:text-white disabled:opacity-30"
                >
                  {t('result_prev_page')}
                </button>
                <span>
                  {page + 1} / {totalPages}
                </span>
                <button
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="hover:text-white disabled:opacity-30"
                >
                  {t('result_next_page')}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
