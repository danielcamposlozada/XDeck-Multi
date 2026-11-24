import { SIDE_HEADER_WIDTH } from './config';

export interface LayoutInput {
  /** Number of columns in settings.json, shown or not (the automatic width divides by it). */
  columnCount: number;
  /** columnWidth from settings.json, if set. */
  columnWidth: number | undefined;
  /** Width of the columns area. */
  areaWidth: number;
  zoom: number;
  sideHeaderIndices: ReadonlySet<number>;
  /** Column showing a photo or video full width, if any. */
  expandedIndex: number | null;
  /** Whether each column has a page to show. */
  isPresent: readonly boolean[];
}

export interface ColumnSlot {
  x: number;
  width: number;
  visible: boolean;
}

export interface Layout {
  slots: ColumnSlot[];
  /** Sum of the column widths: what "Fit Window" resizes the window to. */
  naturalWidth: number;
  /** Width of the scrollable content (never narrower than the area). */
  contentWidth: number;
}

/** The same column widths as the macOS edition's ContentView. */
export function computeLayout(input: LayoutInput): Layout {
  const { columnCount, areaWidth, zoom, sideHeaderIndices, expandedIndex } = input;
  const sideHeaderCount = Math.max(sideHeaderIndices.size, 1);
  const baseWidth =
    input.columnWidth ??
    (columnCount <= 1
      ? areaWidth - SIDE_HEADER_WIDTH
      : (areaWidth - SIDE_HEADER_WIDTH * sideHeaderCount) / columnCount);
  const columnWidth = Math.max(0, baseWidth * zoom);

  const slots: ColumnSlot[] = [];
  let x = 0;
  for (let index = 0; index < columnCount; index++) {
    const showsSideHeader = sideHeaderIndices.has(index);
    const isHidden =
      input.isPresent[index] !== true || (expandedIndex !== null && expandedIndex !== index);
    let width: number;
    if (isHidden) {
      width = 0;
    } else if (expandedIndex === index) {
      width = areaWidth;
    } else {
      width = columnWidth + (showsSideHeader ? SIDE_HEADER_WIDTH : 0);
    }
    width = Math.max(0, Math.round(width));
    slots.push({ x, width, visible: width > 0 });
    x += width;
  }
  return { slots, naturalWidth: x, contentWidth: Math.max(x, Math.round(areaWidth)) };
}
