import { CLASSIFICATION_LABELS, type Classification } from "@/lib/types"

interface ClassificationBannerProps {
  classification: Classification
}

const classMap: Record<Classification, string> = {
  U: "bg-green-700/90 text-white",
  CUI: "bg-purple-700 text-white",
  S: "bg-red-700 text-white",
  TS: "bg-yellow-500 text-black",
}

export function ClassificationBanner({
  classification,
}: ClassificationBannerProps) {
  const label = CLASSIFICATION_LABELS[classification]
  return (
    <div
      className={`w-full py-0.5 text-center text-xs font-bold tracking-widest uppercase ${classMap[classification]}`}
      role="banner"
      aria-label={`Classification: ${label}`}
    >
      {label}
    </div>
  )
}
