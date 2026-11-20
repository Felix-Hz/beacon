// Renders the 16x16 pixel mark to assets/icon.svg: a point sending a signal, in the cobalt and paper of
// the felix-hzv.dev design system. Run after changing the grid: node scripts/make-icon.mjs

import { writeFileSync } from "node:fs";

const INK = "#1d3ea8";
const PAPER = "#fafaf8";

// Centre point with two arcs either side; equal 1 px side margins and 3 px top and bottom.
const GRID = [
  "................",
  "................",
  "................",
  "...#........#...",
  "..#..#....#..#..",
  ".#..#......#..#.",
  ".#..#..##..#..#.",
  ".#..#.####.#..#.",
  ".#..#.####.#..#.",
  ".#..#..##..#..#.",
  ".#..#......#..#.",
  "..#..#....#..#..",
  "...#........#...",
  "................",
  "................",
  "................",
];

if (GRID.length !== 16 || GRID.some((row) => row.length !== 16)) throw new Error("the grid must be 16x16");

// One rectangle per horizontal run of lit pixels.
let path = "";
GRID.forEach((row, y) => {
  for (const run of row.matchAll(/#+/g)) path += `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`;
});

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">' +
  `<title>beacon</title><rect width="16" height="16" fill="${INK}"/><path fill="${PAPER}" d="${path}"/></svg>\n`;

writeFileSync(new URL("../assets/icon.svg", import.meta.url), svg);
