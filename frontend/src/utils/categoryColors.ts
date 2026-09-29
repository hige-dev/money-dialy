/** GAS版と共通のカテゴリ配色。 */
export const CATEGORY_COLOR_PALETTE = [
  '#728f75',
  '#d49b55',
  '#7e9db4',
  '#bb7e6d',
  '#9b8bb1',
  '#8ba293',
  '#c7ae61',
  '#82919a',
] as const;

const GOLDEN_ANGLE = 137.507764;
const GENERATED_SATURATIONS = [37, 42, 34, 46];
const GENERATED_LIGHTNESSES = [58, 64, 53, 68];
const DISPLAY_PALETTE_SIZE = 512;
const PREVIOUS_THEME_COLORS = new Set([
  '#bf7954', '#7b8f60', '#61899a', '#9b7baf',
  '#bd7c8c', '#74867d', '#c09a58', '#668f83',
]);

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = ((hue % 360) + 360) % 360 / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const rgb = section < 1
    ? [chroma, secondary, 0]
    : section < 2
      ? [secondary, chroma, 0]
      : section < 3
        ? [0, chroma, secondary]
        : section < 4
          ? [0, secondary, chroma]
          : section < 5
            ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const offset = l - chroma / 2;
  return `#${rgb.map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** GAS配色を先頭に置き、残りを落ち着いた色相で必要数だけ作る。 */
export function categoryPaletteForCount(count: number): string[] {
  const requestedCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const palette: string[] = CATEGORY_COLOR_PALETTE.slice(0, Math.min(requestedCount, CATEGORY_COLOR_PALETTE.length));
  const used = new Set<string>(palette);

  for (let seed = 0; palette.length < requestedCount; seed++) {
    for (let attempt = 0; ; attempt++) {
      const hue = seed * GOLDEN_ANGLE + 21 + attempt * 7.3;
      const saturation = GENERATED_SATURATIONS[(seed + attempt) % GENERATED_SATURATIONS.length];
      const lightness = GENERATED_LIGHTNESSES[(seed * 3 + attempt) % GENERATED_LIGHTNESSES.length];
      const color = hslToHex(hue, saturation, lightness);
      if (used.has(color)) continue;
      used.add(color);
      palette.push(color);
      break;
    }
  }

  return palette;
}

/** 指定位置のテーマ色を返す。カテゴリの追加や並び替えでは既存保存色を変更しない。 */
export function categoryColorForIndex(index: number): string {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0;
  return categoryPaletteForCount(safeIndex + 1)[safeIndex];
}

/** 既存の表示色を避けて、新しいカテゴリに割り当てる色を選ぶ。 */
export function nextAvailableCategoryColor(usedRawColors: readonly string[]): string {
  const used = new Set(usedRawColors.map(categoryDisplayColor));
  const candidates = categoryPaletteForCount(Math.max(CATEGORY_COLOR_PALETTE.length, usedRawColors.length + 1));
  return candidates.find((color) => !used.has(color)) || categoryColorForIndex(candidates.length);
}

function parseHexColor(rawColor: string): [number, number, number] | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(rawColor);
  if (!match) return null;
  const hex = match[1].length === 3
    ? [...match[1]].map((digit) => digit + digit).join('')
    : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

const DISPLAY_PALETTE = categoryPaletteForCount(DISPLAY_PALETTE_SIZE);
const DISPLAY_PALETTE_CHANNELS = DISPLAY_PALETTE.map((color) => ({ color, channels: parseHexColor(color)! }));

function isGeneratedThemeColor(channels: [number, number, number]): boolean {
  const [red, green, blue] = channels.map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  return GENERATED_SATURATIONS.some((value) => Math.abs(saturation - value / 100) <= 0.015)
    && GENERATED_LIGHTNESSES.some((value) => Math.abs(lightness - value / 100) <= 0.015);
}

/** 保存値を変えず、表示色だけを固定テーマ配色へそろえる。 */
export function categoryDisplayColor(rawColor: string): string {
  const source = parseHexColor(rawColor);
  if (!source) return rawColor;

  const normalized = `#${source.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  if (!PREVIOUS_THEME_COLORS.has(normalized)
    && (CATEGORY_COLOR_PALETTE.includes(normalized as (typeof CATEGORY_COLOR_PALETTE)[number])
      || isGeneratedThemeColor(source))) {
    return normalized;
  }

  const [red, green, blue] = source;
  return DISPLAY_PALETTE_CHANNELS.reduce<{ color: string; distance: number }>((nearest, candidate) => {
    const channels = candidate.channels;
    const [candidateRed, candidateGreen, candidateBlue] = channels;
    const redMean = (red + candidateRed) / 2;
    const redDifference = red - candidateRed;
    const greenDifference = green - candidateGreen;
    const blueDifference = blue - candidateBlue;
    const distance = (2 + redMean / 255) * redDifference ** 2
      + 4 * greenDifference ** 2
      + (2 + (255 - redMean) / 255) * blueDifference ** 2;
    return distance < nearest.distance ? { color: candidate.color, distance } : nearest;
  }, { color: DISPLAY_PALETTE_CHANNELS[0].color, distance: Number.POSITIVE_INFINITY }).color;
}
