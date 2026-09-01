/** lucide's GripVertical at this size renders as two thin strokes rather than
 *  the six dots the icon is meant to be, which reads as a divider next to a
 *  real one. Drawn here so the handle looks like something you grab.
 *
 *  Its own module once a second draggable list wanted it: the package page's
 *  UTC rows and the capability rows are both things you pick up and drop
 *  somewhere else, and a handle that differs between them would suggest they
 *  behave differently. */
export function GripDots() {
  return (
    <svg
      viewBox="0 0 10 16"
      className="size-4 fill-current"
      aria-hidden="true"
      focusable="false"
    >
      {[3, 8, 13].map((y) =>
        [3, 7].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />),
      )}
    </svg>
  )
}
