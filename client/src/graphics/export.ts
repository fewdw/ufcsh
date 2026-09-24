/** Canvas encoding finishes asynchronously; toBlob itself returns nothing. */
export function graphicBlob(canvas: HTMLCanvasElement | null): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!canvas) { reject(new Error("No graphic is ready.")); return; }
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not encode the graphic.")), "image/png");
  });
}
