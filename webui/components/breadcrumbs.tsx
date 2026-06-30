"use client"

import Link from "next/link"
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export interface CrumbItem {
  label: string
  href?: string
}

interface CtxValue {
  crumbs: CrumbItem[]
  setCrumbs: (items: CrumbItem[]) => void
}

const Ctx = createContext<CtxValue | null>(null)

export function BreadcrumbsProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumbs] = useState<CrumbItem[]>([])
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function useBreadcrumbsContext(): CtxValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useBreadcrumbs must be inside BreadcrumbsProvider")
  return v
}

/** Render in a page to register its breadcrumbs with the site header. */
export function PageBreadcrumbs({ items }: { items: CrumbItem[] }) {
  const { setCrumbs } = useBreadcrumbsContext()
  const key = JSON.stringify(items)
  useLayoutEffect(() => {
    setCrumbs(items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}

/** Visual breadcrumbs trail (consumed by SiteHeader). */
export function HeaderBreadcrumbs() {
  const { crumbs } = useBreadcrumbsContext()
  if (crumbs.length === 0) return null

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <span key={i} className="contents">
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast || !c.href ? (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link href={c.href} />}>
                    {c.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
