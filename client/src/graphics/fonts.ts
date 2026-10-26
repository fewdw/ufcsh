/**
 * The two faces the graphics are set in, served from this site (both OFL, see
 * /fonts/anton and /fonts/inter): Anton for names and figures, Inter for everything small.
 * A canvas only draws a font the document has already loaded, so the builder
 * waits for these before its first frame. Loaded once, on first use, and only
 * by the builder.
 */

export const DISPLAY = "UFCsh Anton";
export const TEXT = "UFCsh Inter";

const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT = "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";
const FACES: { family: string; folder: string; weight: string }[] = [
  { family: DISPLAY, folder: "anton", weight: "400" },
  // One variable file covers every weight the graphics use.
  { family: TEXT, folder: "inter", weight: "100 900" },
];

let loading: Promise<void> | null = null;

/** Resolves once every face is ready, or quietly after a failure: the
 *  graphics then fall back to system faces rather than not drawing. */
export function loadGraphicFonts(): Promise<void> {
  if (loading) return loading;
  if (typeof FontFace === "undefined" || typeof document === "undefined") return (loading = Promise.resolve());
  const faces = FACES.flatMap(({ family, folder, weight }) => [["latin", LATIN], ["latin-ext", LATIN_EXT]].map(([subset, range]) =>
    new FontFace(family, `url(/fonts/${folder}/${folder}-${subset}.woff2) format("woff2")`, { weight, unicodeRange: range })));
  loading = Promise.all(faces.map(async (face) => {
    await face.load();
    document.fonts.add(face);
  })).then(() => undefined, () => undefined);
  return loading;
}
