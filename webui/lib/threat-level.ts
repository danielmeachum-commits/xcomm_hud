import type { Emcon, Fpcon } from "./types"

export const FPCON_LEVELS: Fpcon[] = [
  "normal",
  "alpha",
  "bravo",
  "charlie",
  "delta",
]

export const EMCON_LEVELS: Emcon[] = ["a", "b", "c", "d"]

export function fpconLabel(f: Fpcon): string {
  switch (f) {
    case "normal":
      return "NORMAL"
    case "alpha":
      return "ALPHA"
    case "bravo":
      return "BRAVO"
    case "charlie":
      return "CHARLIE"
    case "delta":
      return "DELTA"
  }
}

export function emconLabel(e: Emcon): string {
  return `EMCON ${e.toUpperCase()}`
}

/** Tailwind classes for the badge background + text. */
export function fpconClasses(f: Fpcon): {
  bg: string
  text: string
  ring: string
} {
  switch (f) {
    case "normal":
      return {
        bg: "bg-emerald-600",
        text: "text-white",
        ring: "ring-emerald-500/60",
      }
    case "alpha":
      return {
        bg: "bg-sky-600",
        text: "text-white",
        ring: "ring-sky-500/60",
      }
    case "bravo":
      return {
        bg: "bg-yellow-500",
        text: "text-black",
        ring: "ring-yellow-500/60",
      }
    case "charlie":
      return {
        bg: "bg-orange-600",
        text: "text-white",
        ring: "ring-orange-500/60",
      }
    case "delta":
      return {
        bg: "bg-red-700",
        text: "text-white",
        ring: "ring-red-500/60",
      }
  }
}

export function emconClasses(e: Emcon): { bg: string; text: string } {
  switch (e) {
    case "a":
      return { bg: "bg-slate-300 dark:bg-slate-600", text: "text-slate-900 dark:text-slate-100" }
    case "b":
      return { bg: "bg-slate-500", text: "text-white" }
    case "c":
      return { bg: "bg-slate-700", text: "text-white" }
    case "d":
      return { bg: "bg-slate-900", text: "text-white" }
  }
}
