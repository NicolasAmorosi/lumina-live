import type { Effects, Fill, Line } from "./slide-model";

/**
 * A chart of a `.pptx` slide, resolved from its chart part (`c:chartSpace`)
 * with the values PowerPoint cached in it: what `SlideChart` draws. Filled in
 * by `src/main/slides/pptx/chart.ts`.
 *
 * Main resolves everything that needs the package — colours (the chart style's
 * automatic ones included), fonts, values, number formats — and the painter
 * lays it out, because the layout depends on the size the chart is drawn at.
 * Font sizes are points; line widths EMU; angles degrees, clockwise.
 */
export type ChartModel =
  /** A chart part that won't read (`type`: why), for the compatibility check. */
  | { kind: "unsupported"; type: string }
  | {
      kind: "chart";
      /** The chart area. */
      space: ChartBox;
      /** The text defaults of the whole chart (`c:chartSpace/c:txPr`). */
      font: ChartFont;
      title: ChartTitle | null;
      legend: ChartLegend | null;
      plotArea: ChartBox & { layout: ChartLayout | null };
      /** One or more plots sharing the same axes (a bar + line combo). */
      plots: ChartPlot[];
      /** The category labels, from the first series that has them. */
      categories: ChartValues;
      /** Multi-level categories: the levels above the labels, inner to
       *  outer, each a list of groups starting at a category index. */
      categoryGroups: { text: string; start: number }[][];
      /** Categories (or scatter's X values) and values. `null` for a pie. */
      categoryAxis: ChartAxis | null;
      valueAxis: ChartAxis | null;
      /** A combo's second value scale: which plots (indices) are on it, and its axis. */
      secondary: { plots: number[]; axis: ChartAxis } | null;
      /** `c:date1904`: serial dates count from 1904. */
      date1904: boolean;
      /** A 3-D chart (bar, line, area, pie or surface): how it is seen. */
      view3D: Chart3D | null;
    };

/**
 * `c:view3D`, the walls, and the 3-D plot's depth settings. Angles are
 * degrees: `rotX` the elevation (a pie's tilt), `rotY` the turn about the
 * vertical (a pie's first slice).
 */
export type Chart3D = {
  rotX: number;
  rotY: number;
  /** `rAngAx`: an oblique view that keeps the front face square, no perspective. */
  rightAngles: boolean;
  /** The field of view, degrees (`perspective` is in half degrees); 0 = none. */
  fov: number;
  /** `depthPercent`: a row's depth, percent of a category's width. */
  depth: number;
  /** `gapDepth`: the gap between rows, percent of a bar's depth. */
  gapDepth: number;
  /** `c:shape` of 3-D bars. */
  shape: "box" | "cylinder" | "cone" | "coneToMax" | "pyramid" | "pyramidToMax";
  floor: ChartBox;
  sideWall: ChartBox;
  backWall: ChartBox;
};

export type ChartFont = {
  /** The face as the file names it (theme fonts resolved). */
  face: string;
  /** Points. */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
};

export type ChartBox = { fill: Fill | null; line: Line | null; effects: Effects };

/** `c:manualLayout`, in fractions of the chart area. `inner` places the plot
 *  area's inside (without tick labels) instead of its outside. */
export type ChartLayout = { x: number | null; y: number | null; w: number | null; h: number | null; inner: boolean };

/** Rich text: paragraphs of runs, every run with its font resolved. */
export type ChartText = { align: "l" | "ctr" | "r"; runs: { text: string; font: ChartFont }[] }[];

export type ChartTitle = ChartBox & {
  text: ChartText;
  overlay: boolean;
  layout: ChartLayout | null;
  /** `bodyPr@rot`, degrees: an axis title on a vertical axis reads upwards. */
  rotation: number | null;
};

export type ChartLegend = ChartBox & {
  pos: "r" | "l" | "t" | "b" | "tr";
  overlay: boolean;
  layout: ChartLayout | null;
  font: ChartFont;
  /** `c:legendEntry` deleted, by entry index. */
  hidden: number[];
};

/** Cached values: numbers or strings, `null` where the cache has no point. */
export type ChartValues = { values: (number | string | null)[]; format: string };

export type ChartMarker = {
  symbol: "circle" | "dash" | "diamond" | "dot" | "none" | "plus" | "square" | "star" | "triangle" | "x";
  /** Points. */
  size: number;
  fill: Fill | null;
  line: Line | null;
  effects: Effects;
};

export type ChartPoint = { fill: Fill | null; line: Line | null; effects: Effects; marker: ChartMarker | null; explosion: number };

export type ChartDataLabel = {
  value: boolean;
  percent: boolean;
  category: boolean;
  series: boolean;
  separator: string | null;
  position: "ctr" | "inEnd" | "inBase" | "outEnd" | "t" | "b" | "l" | "r" | "bestFit" | null;
  /** `null`: the values' own format. */
  format: string | null;
  font: ChartFont;
  fill: Fill | null;
  line: Line | null;
  /** A bubble's size. */
  size: boolean;
  /** A label the user dragged: its offset, in fractions of the chart area. */
  offset: { x: number; y: number } | null;
  /** A label whose text was typed over (or comes from cells). */
  text: ChartText | null;
  /** A key of the series' colour before the text. */
  legendKey: boolean;
};

export type ChartSeries = {
  /** `c:idx`: what automatic colours and markers are counted by. */
  index: number;
  name: string;
  values: ChartValues;
  /** Scatter and bubble: the X values (`null` → 1, 2, 3, …). */
  xValues: ChartValues | null;
  /** Bubble: the sizes; `bubble3D` draws them as spheres. */
  sizes: ChartValues | null;
  bubble3D: boolean;
  fill: Fill | null;
  line: Line | null;
  effects: Effects;
  marker: ChartMarker | null;
  /** Per point, when a point differs (`c:dPt`, `varyColors`); `null` = all as the series. */
  points: ChartPoint[] | null;
  smooth: boolean;
  /** Pie: how far the slices are pulled out, percent of the radius. */
  explosion: number;
  /** Per point; `null` where no label shows. */
  labels: (ChartDataLabel | null)[];
};

export type ChartGrouping = "clustered" | "standard" | "stacked" | "percentStacked";

export type ChartPlot =
  | { kind: "bar"; horizontal: boolean; grouping: ChartGrouping; gapWidth: number; overlap: number; series: ChartSeries[] }
  | { kind: "line"; grouping: ChartGrouping; series: ChartSeries[] }
  | { kind: "area"; grouping: ChartGrouping; series: ChartSeries[] }
  /** Pie and doughnut (`holeSize` > 0). */
  | { kind: "pie"; firstSliceAngle: number; holeSize: number; series: ChartSeries[] }
  | { kind: "scatter"; series: ChartSeries[] }
  /** `scale`: the biggest bubble, percent of the default; `byWidth`: size is
   *  the diameter (else the area); `negatives`: draw negative sizes. */
  | { kind: "bubble"; scale: number; byWidth: boolean; negatives: boolean; series: ChartSeries[] }
  /** Categories around a circle: lines (with markers as each series says) or filled. */
  | { kind: "radar"; filled: boolean; series: ChartSeries[] }
  /** A mesh over categories × series, coloured by value band (one box per
   *  major unit of the value axis, cycling). */
  | { kind: "surface"; wireframe: boolean; bands: ChartBox[]; series: ChartSeries[] };

export type ChartTick = "out" | "in" | "cross" | "none";

export type ChartAxis = {
  kind: "category" | "date" | "value";
  deleted: boolean;
  /** `orientation@maxMin`. */
  reversed: boolean;
  min: number | null;
  max: number | null;
  majorUnit: number | null;
  minorUnit: number | null;
  /** `null`: the values' own format (`sourceLinked`). */
  format: string | null;
  labels: "nextTo" | "low" | "high" | "none";
  majorTick: ChartTick;
  line: Line | null;
  majorGrid: Line | null;
  minorGrid: Line | null;
  font: ChartFont;
  /** Degrees; `null` lets the painter choose (horizontal, or slanted when they don't fit). */
  rotation: number | null;
  /** Where this axis crosses the other one: at the other's zero (or the end
   *  its data are on), its minimum, its maximum or a value. */
  crosses: "autoZero" | "min" | "max" | number;
  /** On a value axis: whether categories sit between ticks or on them. */
  between: boolean;
  title: ChartTitle | null;
  labelSkip: number | null;
  tickSkip: number | null;
  /** `c:lblOffset`, percent. */
  labelOffset: number;
};
