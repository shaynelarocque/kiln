/**
 * How a single image splits into frames: a horizontal or vertical strip of square frames, as
 * pixel-art tools export them. Anything else is one frame.
 */
export function stripFrames(width: number, height: number) {
  if (width > height && width % height === 0)
    return { count: width / height, size: height, across: true }
  if (height > width && height % width === 0)
    return { count: height / width, size: width, across: false }
  return { count: 1, size: 0, across: true }
}

/** Files in the order their names number them: frame2 before frame10. */
export const byNumberedName = <T extends { name: string }>(files: T[]) =>
  [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
